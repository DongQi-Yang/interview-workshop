import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

struct Req: Decodable { let system: String; let prompt: String }

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(1)
}

if CommandLine.arguments.contains("--check") {
    #if canImport(FoundationModels)
    if #available(macOS 26.0, *) {
        switch SystemLanguageModel.default.availability {
        case .available: print("ok"); exit(0)
        default: fail("端侧模型不可用（未开启 Apple Intelligence 或机型不支持）")
        }
    } else { fail("需要 macOS 26+") }
    #else
    fail("当前 SDK 无 FoundationModels 框架")
    #endif
}

#if canImport(FoundationModels)
if #available(macOS 26.0, *) {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard let req = try? JSONDecoder().decode(Req.self, from: data) else {
        fail("stdin 不是合法的 {system, prompt} JSON")
    }
    let semaphore = DispatchSemaphore(value: 0)
    Task {
        do {
            let session = LanguageModelSession(instructions: req.system)
            let response = try await session.respond(to: req.prompt)
            print(response.content)
            exit(0)
        } catch {
            fail("端侧推理失败: \(error)")
        }
    }
    semaphore.wait()
} else { fail("需要 macOS 26+") }
#else
fail("当前 SDK 无 FoundationModels 框架")
#endif
