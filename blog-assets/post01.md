# 50MB 红线下的 iOS 录屏引擎：ReplayKit Broadcast Extension 实战

> 这篇文章讲的是一件很具体的事：如何在 iOS 系统给你的 50MB 内存里，把整块屏幕实时编码成一个「随时被杀都能播」的视频文件。
>
> 这些坑我基本都踩过一遍。写下来，希望能让后来的人少绕点路。

---

## 一、先说结论：这不是"优化"问题，是"架构"问题

如果你正在做 iOS 录屏，大概率会经历这样一个过程：

1. 按教程搭起 Broadcast Upload Extension，`processSampleBuffer` 里塞进 `AVAssetWriter`，跑通了，很兴奋；
2. 录 10 秒没问题，录 1 分钟没问题；
3. 用户开始反馈：**录到一半自动停了**；
4. 你去看日志——什么都没有。没有崩溃堆栈，没有异常，`broadcastFinished(withError:)` 都没被调用。进程就这么消失了；
5. 更糟的是，用户去相册里找那个录了 8 分钟的文件——**打不开**。

这不是 bug，这是你撞上了系统红线。

**Broadcast Upload Extension 的内存上限是 50MB。** 超过这个数字，系统不通知、不给你机会清理、不走任何回调，直接 kill 掉整个 Extension 进程。

而 50MB 有多小？我们算一笔账。

---

## 二、把 50MB 换算成帧数

ReplayKit 回调给你的视频帧，是**屏幕原生分辨率**的 NV12（`kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange`，双平面 YUV4:2:0）。

以一台 1170 × 2532 的设备为例，单帧内存占用：

```
Y 平面：1170 × 2532 × 1 byte  = 2.96 MB
UV 平面：1170 × 2532 × 0.5 byte = 1.48 MB
─────────────────────────────────────────
单帧合计 ≈ 4.44 MB
```

**50 ÷ 4.44 ≈ 11 帧。**

![50MB 换算成帧：单帧 4.44MB，理论 11 帧，实际可用不到 5 帧](博客01-配图/fig2.png)

这就是全部预算。而且这 11 帧还是理论值——你的代码、编码器上下文、文件缓冲、系统运行时全都要从这 50MB 里扣。真正留给帧数据的，实际能用的往往不到 **5 帧**。

60fps 录制下，5 帧 = 83 毫秒。

**这个数字定义了整个架构：你没有任何"缓存一批再处理"的余地。所有涉及"先攒起来"的设计，在这里全部出局。**

包括但不限于：
- ❌ 攒够 N 帧再批量编码
- ❌ 把帧丢进队列，另开线程慢慢消费（队列会瞬间涨爆）
- ❌ 先录原始帧到临时文件，结束后再转码（磁盘 IO 顶不住 60fps × 4.4MB = 266 MB/s）
- ❌ 中途用 `UIImage` / `CIImage` 做任何处理（这两个东西的内存行为不受你控制）

能活下来的架构只有一种：**帧到达 → 立刻处理 → 立刻编码 → 立刻落盘 → 立刻释放。全程不驻留、不排队、不回头。**

![流式录屏管线：ReplayKit → 零拷贝纹理 → Metal → VideoToolbox → fMP4 Muxer → 磁盘](博客01-配图/fig3.png)

---

## 三、坑 1：那个 CMSampleBuffer 不是你的

新手最容易犯的错，是把回调里的 `sampleBuffer` 存起来。

```swift
override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer,
                                  with type: RPSampleBufferType) {
    // ❌ 灾难写法
    self.pendingFrames.append(sampleBuffer)
}
```

这段代码有两个致命问题，而且第二个问题比第一个更隐蔽。

**问题一，显而易见的：** 内存瞬间爆掉。前面算过了，11 帧封顶。

**问题二，隐蔽的：** ReplayKit 传给你的 `CVPixelBuffer` 来自一个**容量固定的 IOSurface 池**。你持有一帧，池子里就少一个可用槽位。当池子被你耗尽时，系统不会报错——它会**停止给你送帧**。

于是你会观察到一个非常诡异的现象：录制没崩溃，进程还活着，但画面卡在某一秒不动了。你去查编码器、查写文件、查线程，全都正常。真正的原因是上游已经不给你数据了，因为帧池被你自己攥在手里。

**正确做法：在回调返回前完成一切，或者只保留你真正需要的那点数据。**

```swift
override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer,
                                  with type: RPSampleBufferType) {
    switch type {
    case .video:
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)

        // 同步走完：渲染 → 送编码器。
        // VTCompressionSessionEncodeFrame 内部会自己 retain pixelBuffer，
        // 我们不需要（也绝不应该）额外持有。
        videoPipeline.encode(pixelBuffer, pts: pts)

    case .audioApp:
        audioPipeline.mix(sampleBuffer, channel: .app)

    case .audioMic:
        audioPipeline.mix(sampleBuffer, channel: .mic)

    @unknown default:
        break
    }
}
```

有一个必须理解的前提：**`processSampleBuffer` 是在系统的串行队列上调用的，同步处理是被允许的。** 你不需要为了"不阻塞回调"而把工作丢到别的队列——那样做只会把内存压力从一个地方转移到另一个地方。

真正需要异步的只有一处：`VTCompressionSession` 的编码结果是通过回调异步返回的。这是 VideoToolbox 自己的行为，它内部的帧缓冲数量是可以通过属性约束的（后面讲）。

---

## 四、坑 2：文件录了 8 分钟，为什么打不开

这是我认为整件事里最值得写的一个点，因为它**不是内存问题，但和内存问题致命地耦合在一起**。

### 标准 MP4 的结构性缺陷

一个普通 MP4 文件长这样（下图上半部分）：

![标准 MP4 与 fMP4 在进程被 kill 时的差别](博客01-配图/fig1.png)

关键在于 **`moov` box 在文件末尾，而且只有在调用 `finishWriting` 时才写入**。

`moov` 里存的是整个文件的索引：每一帧在文件的哪个字节偏移、多长、什么时间播放。没有它，`mdat` 里那几百兆的 H.264 数据就是一堆无法解释的字节——**播放器连第一帧都解不出来**。

现在把它和 50MB 红线放在一起看：

> 进程被系统 kill → `finishWriting` 永远不会被调用 → `moov` 永远不会写入 → **用户录了 8 分钟的内容，100% 全部丢失。**

不是丢失末尾几秒。是**整个文件报废**。

这个组合是致命的：内存越界的惩罚，从"录制中断"升级成了"数据全灭"。而录屏这个场景，用户往往是在录一段不可重现的内容（游戏高光、线上会议、一次性的操作演示）。丢了就是丢了。

### 解法：fMP4（Fragmented MP4）

fMP4 把文件重新组织成上图下半部分的样子。两处关键变化：

1. **`moov` 移到文件开头，并且在录制开始的那一刻就写完。** 它内部的 `stts`/`stsc`/`stsz`/`stco` 采样表全部是空的（0 条目），只保留轨道描述（分辨率、编码格式、SPS/PPS）和一个 `mvex` box——`mvex` 的作用就是告诉播放器："这个文件是分片的，索引在后面每个分片里"。

2. **每个 `moof` 自带这一片的完整索引。** 播放器读到 `moof` 就能解出紧跟其后的 `mdat`。

于是性质变了：

> 进程在任意时刻被杀 → 已经落盘的每一个 `moof + mdat` 对都是**自洽且可播放**的 → 用户只丢掉最后那个未完成的分片（通常 < 1 秒）。

**从"全灭"变成"损失最后一秒"。** 这就是自己写封装的全部理由。

### 关于 AVAssetWriter 的公平说法

必须说清楚：**AVAssetWriter 也能输出 fMP4。** iOS 14 起提供了 `AVAssetWriterDelegate` + `preferredOutputSegmentInterval`，可以按间隔拿到 segment data 自己写盘：

```swift
writer.outputFileTypeProfile = .mpeg4AppleHLS
writer.preferredOutputSegmentInterval = CMTime(seconds: 1, preferredTimescale: 1)
writer.delegate = self
// AVAssetWriterDelegate:
// func assetWriter(_:didOutputSegmentData:segmentType:segmentReport:)
```

如果你的项目能接受 iOS 14+ 且需求不复杂，**这条路是对的，先走这条**。不要为了炫技去手写 muxer。

我们最终选择自己实现，是三个诉求叠加起来 AVAssetWriter 满足不了：

- **版本门槛，这条最硬**：`AVAssetWriterDelegate` 的分段输出是 **iOS 14** 才有的。而录屏这类工具产品的用户构成里，老设备占比通常远高于开发者的直觉——去 App Store Connect 后台看一眼系统版本分布就明白了。为了一个封装特性把最低支持版本抬上去，商业上根本谈不拢。自己写 muxer 的意思是**封装逻辑和系统版本彻底解耦**：iOS 11 和 iOS 18 上跑的是同一套字节，行为完全一致。

- **`preferredOutputSegmentInterval` 是"偏好"，不是"保证"**：系统会把切分点对齐到关键帧边界，实际分片长度可能明显偏离你设的值。平时无所谓，但当你要对外承诺一个确定的崩溃恢复窗口（"异常中断最多丢 1 秒"）时，这个不确定性就直接变成了产品指标上的不确定性。自己控制分片，这个上界才是你说了算的。

- **内存行为是黑盒**：AVAssetWriter 内部的缓冲策略你既看不见也调不动。在 50MB 里，"大概够用"和"确定够用"是两种不同的东西——前者意味着线上出问题时你只能换参数碰运气，后者意味着**每一个字节的去向都可解释**。自研 muxer 最大的收益其实不是省内存，是可归因。

这是一个**成本很高的决定**，不要轻易做。手写 muxer 意味着你要对着 ISO/IEC 14496-12 规范逐个 box 啃，而且调试极其痛苦——错一个字节，播放器只会告诉你"文件损坏"，不会告诉你哪错了。

### 手写 muxer 时最容易翻车的三个字段

如果你真的走上这条路，这三个地方值得提前知道：

**1. `trun.data_offset` 是相对 `moof` 起始位置的偏移**

不是相对文件开头，不是相对 `mdat`。而这带来一个先有鸡还是先有蛋的问题：你必须**先知道 `moof` 的总大小**，才能算出这个偏移；但 `moof` 的大小又取决于里面装了多少个 sample。

解法是两趟：先把所有 sample 的信息收集完，算出 `trun` 的确切字节数 → 反推 `moof` 总长 → 再回填 `data_offset` → 最后一次性写出。在内存里操作一个几百字节的 box 头是完全可以接受的，注意别把 `mdat` 的实际数据也放进来凑热闹。

**2. `tfdt.baseMediaDecodeTime` 必须严格累加**

这个字段是每个分片的时间锚点。播放器靠它把分散的分片拼回一条连续时间轴。

它必须是**这个分片第一个 sample 的解码时间，以 media timescale 为单位，从 0 开始累加**。一旦某个分片算错，后面所有分片的时间轴全部偏移——表现为播放到某个点之后音画不同步，或者进度条乱跳。

我的建议是：**用整数累加，绝不用浮点。** 维护一个 `UInt64` 的累计值，每写一个 sample 就加上它的 duration。用 `Double` 存时间戳迟早会被浮点误差累积坑到。

**3. MP4 里的 H.264 是 AVCC 格式，不是 Annex-B**

VideoToolbox 编码出来的 `CMBlockBuffer` 已经是 AVCC（4 字节大端长度前缀 + NALU），这点是对的，直接写 `mdat` 即可。

但 SPS/PPS 不在里面，要单独从 format description 里取出来构造 `avcC` box，放进 `moov` 的 `stsd`：

```swift
var spsSize = 0, spsCount = 0
var sps: UnsafePointer<UInt8>?
CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
    formatDesc, parameterSetIndex: 0,
    parameterSetPointerOut: &sps,
    parameterSetSizeOut: &spsSize,
    parameterSetCountOut: &spsCount,
    nalUnitHeaderLengthOut: nil)
// index 1 取 PPS，同理
```

注意 `avcC` 里的 `lengthSizeMinusOne` 字段要和实际前缀长度一致（VideoToolbox 默认 4 字节，所以填 3）。这个字段填错的表现是：播放器能识别文件、能读出时长、但画面全绿或全花。

---

## 五、坑 3：渲染路径上一次 CPU 拷贝就够你死一次

录屏不是把屏幕原样存下来就完了。通常还要做：加水印、裁剪区域、贴摄像头小窗、旋转适配横竖屏。

这就需要渲染。而渲染是内存管理最容易翻车的地方。

**错误示范**（这段代码能跑，能出画面，然后会在 30 秒后杀死你的 Extension）：

```swift
// ❌ 每一帧都在 50MB 里搞出好几个大对象
let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
let output = ciImage.applyingFilter("CIWatermark", parameters: [...])
let cgImage = ciContext.createCGImage(output, from: output.extent)
let uiImage = UIImage(cgImage: cgImage!)
```

`CIContext` 内部有自己的缓存池，`createCGImage` 会实打实分配一块全尺寸位图。在正常 App 里这些都不算事，在 50MB 的 Extension 里，**任何一次全帧 CPU 拷贝都是奢侈品**。

**正确做法：零拷贝纹理。**

`CVPixelBuffer` 底层是 IOSurface，GPU 可以直接读。通过 `CVMetalTextureCache` 建立映射，**不产生任何数据拷贝**——只是给同一块显存换了个 GPU 能理解的视角：

```swift
// NV12 是双平面，Y 和 UV 分别绑定两张纹理
private func makeTextures(from pixelBuffer: CVPixelBuffer)
        -> (y: MTLTexture, uv: MTLTexture)? {

    let w = CVPixelBufferGetWidth(pixelBuffer)
    let h = CVPixelBufferGetHeight(pixelBuffer)

    var yRef: CVMetalTexture?
    var uvRef: CVMetalTexture?

    // plane 0: Y，单通道 8 位
    CVMetalTextureCacheCreateTextureFromImage(
        kCFAllocatorDefault, textureCache, pixelBuffer, nil,
        .r8Unorm, w, h, 0, &yRef)

    // plane 1: UV 交织，双通道 8 位，尺寸减半
    CVMetalTextureCacheCreateTextureFromImage(
        kCFAllocatorDefault, textureCache, pixelBuffer, nil,
        .rg8Unorm, w / 2, h / 2, 1, &uvRef)

    guard let y = yRef.flatMap(CVMetalTextureGetTexture),
          let uv = uvRef.flatMap(CVMetalTextureGetTexture) else { return nil }
    return (y, uv)
}
```

YUV → RGB 的转换放进 shader 里做，一次采样解决：

```metal
fragment float4 nv12_to_rgb(VertexOut in [[stage_in]],
                            texture2d<float> yTex  [[texture(0)]],
                            texture2d<float> uvTex [[texture(1)]]) {
    constexpr sampler s(filter::linear);
    float  y  = yTex.sample(s, in.uv).r;
    float2 uv = uvTex.sample(s, in.uv).rg - float2(0.5, 0.5);

    // BT.601 VideoRange。⚠️ 见下方说明
    y = (y - 16.0/255.0) * (255.0/219.0);
    float r = y + 1.402 * uv.y;
    float g = y - 0.344136 * uv.x - 0.714136 * uv.y;
    float b = y + 1.772 * uv.x;
    return float4(r, g, b, 1.0);
}
```

### ⚠️ 一个非常容易被忽略的细节：色彩范围

上面那段转换公式，**用错了不会崩溃、不会报错，只会让你的视频"看起来有点不对"**——通常表现为发灰、对比度不足，或者黑色不够黑。这类问题往往上线好几个版本才被用户以"画质差"的模糊描述反馈上来，然后你要花很久才定位到。

必须区分两组正交的选择：

| 维度 | 选项 | 判断依据 |
|---|---|---|
| **量化范围** | VideoRange (16–235) / FullRange (0–255) | 看 pixel format：`...VideoRange` 还是 `...FullRange` |
| **色域矩阵** | BT.601 / BT.709 | 读 `CVBufferGetAttachment(pb, kCVImageBufferYCbCrMatrixKey)` |

不要写死。**从 pixel buffer 的 attachment 里读，按实际值选矩阵**：

```swift
let matrix = CVBufferGetAttachment(pixelBuffer,
    kCVImageBufferYCbCrMatrixKey, nil)?.takeUnretainedValue()
let isBT709 = (matrix as? NSString) == (kCVImageBufferYCbCrMatrix_ITU_R_709_2 as NSString)
```

同样地，编码时也要把对应的色彩信息写回去，否则播放器会用默认值猜，猜错了就偏色：

```swift
VTSessionSetProperty(session, key: kVTCompressionPropertyKey_ColorPrimaries,
                     value: kCVImageBufferColorPrimaries_ITU_R_709_2)
VTSessionSetProperty(session, key: kVTCompressionPropertyKey_TransferFunction,
                     value: kCVImageBufferTransferFunction_ITU_R_709_2)
VTSessionSetProperty(session, key: kVTCompressionPropertyKey_YCbCrMatrix,
                     value: kCVImageBufferYCbCrMatrix_ITU_R_709_2)
```

---

## 六、坑 4：别猜内存，去读它

大部分人调内存靠 Instruments 跑几轮，看着差不多就上线了。在 Extension 场景这不够——**设备差异极大**，你在 iPhone 15 Pro 上测得好好的，到某台老设备上分辨率和帧池行为都变了。

iOS 13 起有一个 API 专门解决这件事，但知道的人不多：

```swift
import os

let remaining = os_proc_available_memory()   // 当前进程还能用多少字节
```

**`os_proc_available_memory()` 返回的是当前进程距离被 kill 还剩多少字节。** 在 Extension 里它直接反映你离那条 50MB 红线还有多远。

有了它，就可以做真正的自适应降级，而不是靠机型白名单去猜：

```swift
private func currentPressureLevel() -> PressureLevel {
    let mb = os_proc_available_memory() / (1024 * 1024)
    switch mb {
    case ..<5:   return .critical   // 命悬一线
    case ..<12:  return .high
    case ..<20:  return .moderate
    default:     return .normal
    }
}

private func applyBackpressure() {
    switch currentPressureLevel() {
    case .normal:
        break

    case .moderate:
        // 先牺牲帧率——比牺牲清晰度更不易察觉
        encoder.targetFrameRate = 30

    case .high:
        // 再降分辨率，同时跳过非必要的渲染合成
        encoder.scaleFactor = 0.75
        renderer.skipOverlay = true

    case .critical:
        // 最后的手段：立刻 flush 当前分片并主动收尾。
        // 主动停止 → 文件完整；被系统 kill → 丢最后一片。
        // 这里必须自己抢在系统前面动手。
        muxer.flushCurrentFragment()
        finishBroadcastGracefully()
    }
}
```

最后那个 `.critical` 分支是整套设计的收口：**与其等系统来杀你，不如自己先体面地停下来。** 用户看到"因内存不足已保存并停止录制"，比看到一个打不开的文件，体验差了不止一个数量级。

配套的编码器设置也要为低内存服务：

```swift
// 实时模式：宁可丢帧，也不要在内部堆积待编码帧
VTSessionSetProperty(session,
    key: kVTCompressionPropertyKey_RealTime, value: kCFBooleanTrue)

// 关闭 B 帧（理由见下一节）
VTSessionSetProperty(session,
    key: kVTCompressionPropertyKey_AllowFrameReordering, value: kCFBooleanFalse)

// 限制内部帧缓冲数量，这是能直接换算成内存的一项
VTSessionSetProperty(session,
    key: kVTCompressionPropertyKey_MaxFrameDelayCount, value: 1 as CFNumber)
```

---

## 七、坑 5：关掉 B 帧，能省掉一整类 bug

H.264 的 B 帧（双向预测帧）能显著提升压缩率，代价是**解码顺序和显示顺序不一致**，于是 `DTS ≠ PTS`，封装时必须为每个 sample 正确计算 `composition time offset`（`trun` 里的 `sample_composition_time_offset`）。

算错的表现是：画面一顿一顿地倒退、或者音画慢慢地越飘越远。而且这类问题**在短视频上测不出来**，往往要录满几分钟才显形。

录屏场景我的建议非常明确：**直接关掉。**

```swift
VTSessionSetProperty(session,
    key: kVTCompressionPropertyKey_AllowFrameReordering,
    value: kCFBooleanFalse)
```

理由：

1. `DTS == PTS`，封装逻辑少掉一整个维度的复杂度和一整类难查的 bug；
2. 屏幕内容本身帧间差异极小（大部分时间是静止 UI），B 帧带来的额外压缩收益远不如自然视频明显；
3. 实时编码本来就不该引入重排序延迟。

**用一点点码率，换掉一类最难排查的时间戳 bug。这笔交易在录屏场景稳赚。**

另外记得设置关键帧间隔，否则播放器 seek 会很难受：

```swift
VTSessionSetProperty(session,
    key: kVTCompressionPropertyKey_MaxKeyFrameInterval,
    value: 60 as CFNumber)   // 30fps 下约 2 秒一个 I 帧
```

---

## 八、坑 6：Extension 是另一个进程，它什么都不知道

这是架构层面容易被低估的一点：**Broadcast Upload Extension 和你的主 App 是两个独立进程。**

它拿不到主 App 的任何内存状态、单例、用户配置。它甚至不知道自己属于哪个用户。

跨进程通信只有 **App Group** 这一条正路：

```swift
let group = FileManager.default
    .containerURL(forSecurityApplicationGroupIdentifier: "group.com.your.app")!

// 配置下行：主 App 写，Extension 读
let config = group.appendingPathComponent("record_config.json")

// 状态上行：Extension 写，主 App 读
let status = group.appendingPathComponent("record_status.json")
```

⚠️ 这里有个坑：`UserDefaults(suiteName:)` 在跨进程场景下**不保证及时同步**，别用它传实时状态。用文件 + 原子写（`Data.write(to:options:.atomic)`），或者用 `CFNotificationCenterGetDarwinNotifyCenter` 做跨进程通知。

**更进一步的限制：Extension 里能用的系统能力是被大幅裁剪的。**

我们在做「录制中状态显示在灵动岛」这个功能时就撞上了这个墙——ActivityKit 在 Broadcast Extension 的进程环境里没法按预期驱动。

最终的解法是把职责拆开：

```
Extension  ──写状态──▶  App Group 共享文件  ──读状态──▶  主 App
（只负责录制）                                    （负责驱动 Live Activity）
```

**Extension 只做它必须做的事（收帧、编码、落盘），所有需要完整 App 环境的能力全部让主 App 代劳。**

这个原则可以推广：每当你在 Extension 里发现某个 API "不工作但也不报错"，先别急着找 workaround，**先问它是不是根本就不该在这个进程里调用**。

### 一个具体例子：你的崩溃监控进不去

这件事有点黑色幽默：**最需要被监控的地方，恰恰是监控最进不去的地方。**

大部分第三方 SDK（埋点、崩溃收集、性能监控）在初始化路径上都会碰这些东西：`UIApplication.shared`、App 生命周期通知、`beginBackgroundTask`。这些在 Extension 里的下场分三档——编译期就被 `NS_EXTENSION_UNAVAILABLE` 拦掉、运行时静默失效、或者直接把进程带崩。

更麻烦的是另一件事：**Extension 被 OOM kill 时根本不产生崩溃日志。** 它不是崩溃，是被系统主动终止——没有信号、没有异常、没有堆栈。就算你的崩溃收集 SDK 装进去了，它也捕获不到这一类死法。

所以线上排查录屏问题时，你会陷入一个很难受的处境：用户说"录到一半停了"，而你手上什么都没有。

我们的做法是放弃通用 SDK，自己写一个**极简、零依赖、只写文件**的埋点：

```swift
enum ExtTrace {
    private static let url: URL = {
        let dir = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: "group.com.your.app")!
        let u = dir.appendingPathComponent("ext_trace.log")
        if !FileManager.default.fileExists(atPath: u.path) {
            FileManager.default.createFile(atPath: u.path, contents: nil)
        }
        return u
    }()

    /// 只在关键节点调用：开始、首帧、每个分片、降级、收尾。
    /// 单行追加写，不缓冲、不依赖任何 SDK、不碰 UIKit。
    static func mark(_ event: String) {
        let mb = os_proc_available_memory() / (1024 * 1024)
        let line = "\(Date().timeIntervalSince1970),\(event),\(mb)\n"
        guard let h = try? FileHandle(forWritingTo: url) else { return }
        defer { try? h.close() }
        try? h.seekToEnd()
        try? h.write(contentsOf: Data(line.utf8))
    }
}
```

主 App 下次启动时读这个文件、上报、清空。**日志的最后一行就是死亡现场**——那一行的事件名和剩余内存，直接告诉你它死在哪个环节、当时还剩多少。

这套东西加起来不到 50 行，但它是我们能拿到 Extension 线上行为的唯一途径。

### 顺带一个必踩的坑：录制文件要落在哪

Extension 有**自己独立的沙盒**。你在 `NSTemporaryDirectory()` 或 Extension 的 Documents 里写的文件，主 App 是**读不到**的。

录制产物必须直接写进 App Group 容器：

```swift
let output = FileManager.default
    .containerURL(forSecurityApplicationGroupIdentifier: "group.com.your.app")!
    .appendingPathComponent("Recordings/\(sessionID).mp4")
```

别想着"先写临时目录，结束时再搬过去"——录制结束这个时机本身就是不可靠的（进程可能被杀），而且搬运一个几百兆的文件既慢又可能失败。**一开始就写到最终位置**，这也正好和 fMP4 边录边可用的性质吻合。

---

## 九、上线前的检查清单

把这些逐条过一遍，能避开我踩过的绝大部分坑：

**内存**
- [ ] 全链路无全帧 CPU 拷贝（渲染走 Metal 零拷贝纹理）
- [ ] 无任何形式的帧队列 / 帧缓存
- [ ] Extension 内不出现 `UIImage` / `CIImage` / `createCGImage`
- [ ] 接入 `os_proc_available_memory()`，实现分级降级
- [ ] `.critical` 时主动收尾，抢在系统 kill 之前

**文件完整性**
- [ ] 用 fMP4，`moov` 在录制开始时就写完
- [ ] 分片间隔合理（1 秒左右是个好起点）
- [ ] **做过强杀测试**：录制中直接杀进程，文件必须可播
- [ ] `tfdt.baseMediaDecodeTime` 用整数累加，不用浮点

**画质**
- [ ] 色彩范围（Video/Full）和矩阵（601/709）从 attachment 读取，不写死
- [ ] 编码时写回 ColorPrimaries / TransferFunction / YCbCrMatrix
- [ ] `avcC` 的 `lengthSizeMinusOne` 与实际 NALU 前缀长度一致

**稳定性**
- [ ] `AllowFrameReordering = false`（关 B 帧）
- [ ] `RealTime = true`
- [ ] 横竖屏切换时分辨率变化有处理（会触发新的 format description）
- [ ] 跨进程状态用文件原子写，不用 `UserDefaults`
- [ ] 需要完整 App 环境的能力全部移交主 App
- [ ] Extension 内不引入任何依赖 `UIApplication` 的第三方 SDK
- [ ] 有自己的轻量 trace 落盘（OOM kill 不产生崩溃日志，这是唯一的现场）
- [ ] 录制文件直接写 App Group 容器，不做结束时搬运

**测试**
- [ ] 长时录制（30 分钟以上）
- [ ] 低端老设备实测（不能只测最新机型）
- [ ] 录制中接电话 / 切后台 / 锁屏
- [ ] 存储空间不足时的表现

---

## 写在最后

回头看，做这套引擎最大的收获不是学会了几个 API，而是理解了一件事：

**当资源约束足够极端时，它会反过来定义架构。**

50MB 不是一个"需要优化到的目标"，而是一条把大部分常规方案直接排除掉的边界。在这个边界内，"流式、无状态、即时释放"不是一种可选的风格——它是唯一能活下来的形态。

而 `moov` 前置这个决定，本质上是承认了一个现实：**在这种环境里，进程被杀不是异常路径，是必然会发生的路径。** 既然如此，就不该把数据的完整性押在"能正常执行到收尾代码"这个假设上。

这个思路是可以迁移的。任何"随时可能被中断"的场景——后台任务、网络传输、大文件处理——都值得问一句：如果现在这一刻进程没了，用户已经付出的成本，有多少能保住？

---

*如果这篇对你有用，欢迎交流。iOS 音视频、录屏、FFmpeg、VideoToolbox 相关的问题都可以聊。*

*GitHub: [@DongQi-Yang](https://github.com/DongQi-Yang)*
