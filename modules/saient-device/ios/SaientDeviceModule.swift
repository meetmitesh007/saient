import ExpoModulesCore
import Foundation

public final class SaientDeviceModule: Module {
  private func architectureName() -> String {
    #if arch(arm64)
    return "arm64"
    #elseif arch(x86_64)
    return "x86_64"
    #else
    return "unknown"
    #endif
  }

  public func definition() -> ModuleDefinition {
    Name("SaientDevice")

    AsyncFunction("getProfile") { () -> [String: Any] in
      let process = ProcessInfo.processInfo
      return [
        "totalMemoryBytes": Double(process.physicalMemory),
        "logicalCores": process.activeProcessorCount,
        "architecture": architectureName(),
        "platform": process.operatingSystemVersionString,
      ]
    }
  }
}
