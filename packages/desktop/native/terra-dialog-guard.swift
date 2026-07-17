import AppKit
import Accessibility
import ApplicationServices
import Foundation

private struct Options {
    var command = "inspect"
    var bundleIdentifier = "com.citrolabs.ego.lite"
    var processIdentifier: pid_t?
    var executablePathPrefix = ""
    var windowTitle = ""
    var expectedURL = ""
    var timeoutMilliseconds = 0
    var outputPath = ""
    var readyOutputPath = ""
    var expectedFingerprint = ""
    var requireTaskSpaceContext = false
    var promptForAccessibility = false
}

private struct ElementSnapshot {
    let element: AXUIElement
    let role: String
    let subrole: String
    let title: String
    let value: String
    let description: String
    let enabled: Bool
    let actions: [String]
    let readComplete: Bool
}

private struct AXRead<Value> {
    let value: Value
    let present: Bool
    let complete: Bool
}

private struct RawAttributeRead {
    let value: CFTypeRef?
    let present: Bool
    let complete: Bool
}

private struct CustomContentEvidence: Codable, Equatable {
    let label: String
    let value: String
    let source: String
}

private struct CustomContentRead {
    let present: Bool
    let decoded: Bool
    let evidence: [CustomContentEvidence]
    let text: [String]
    let readComplete: Bool
}

private struct DialogResult: Codable {
    let status: String
    let bundleIdentifier: String
    let processIdentifier: Int32?
    let executablePath: String?
    let windowTitle: String?
    let dialogTitle: String?
    let fingerprint: String?
    let candidateCount: Int
    let dialogText: [String]
    let buttonLabels: [String]
    let axReadComplete: Bool
    let customContentPresent: Bool
    let customContentDecoded: Bool
    let customContent: [CustomContentEvidence]
    let hasTextField: Bool
    let treeTruncated: Bool
    let clicked: Bool
    let detectedAt: String?
    let closedAt: String?
    let detail: String
}

private let textRoles = Set([kAXStaticTextRole as String, kAXHeadingRole as String])
private let editableRoles = Set([kAXTextFieldRole as String, kAXTextAreaRole as String, kAXComboBoxRole as String])
// AX subroles are stable string values. Some macOS runner SDKs do not export
// kAXApplicationDialogSubrole even though Chromium reports AXApplicationDialog.
private let applicationDialogSubrole = "AXApplicationDialog"

private func parseOptions() -> Options {
    var options = Options()
    let arguments = Array(CommandLine.arguments.dropFirst())
    if let command = arguments.first, !command.hasPrefix("--") {
        options.command = command
    }
    var index = options.command == arguments.first ? 1 : 0
    while index < arguments.count {
        switch arguments[index] {
        case "--bundle-id":
            index += 1
            if index < arguments.count { options.bundleIdentifier = arguments[index] }
        case "--pid":
            index += 1
            if index < arguments.count, let value = Int32(arguments[index]), value > 0 { options.processIdentifier = value }
        case "--executable-path-prefix":
            index += 1
            if index < arguments.count { options.executablePathPrefix = arguments[index] }
        case "--window-title":
            index += 1
            if index < arguments.count { options.windowTitle = arguments[index] }
        case "--expected-url":
            index += 1
            if index < arguments.count { options.expectedURL = arguments[index] }
        case "--timeout-ms":
            index += 1
            if index < arguments.count { options.timeoutMilliseconds = Int(arguments[index]) ?? 0 }
        case "--output":
            index += 1
            if index < arguments.count { options.outputPath = arguments[index] }
        case "--ready-output":
            index += 1
            if index < arguments.count { options.readyOutputPath = arguments[index] }
        case "--expected-fingerprint":
            index += 1
            if index < arguments.count { options.expectedFingerprint = arguments[index] }
        case "--require-task-space-context":
            options.requireTaskSpaceContext = true
        case "--prompt-accessibility":
            options.promptForAccessibility = true
        default:
            break
        }
        index += 1
    }
    return options
}

private func readAttribute(_ element: AXUIElement, _ name: CFString) -> RawAttributeRead {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, name, &value)
    if error == .success, let value {
        return RawAttributeRead(value: value, present: true, complete: true)
    }
    if error == .noValue || error == .attributeUnsupported {
        return RawAttributeRead(value: nil, present: false, complete: true)
    }
    return RawAttributeRead(value: nil, present: false, complete: false)
}

private func attribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
    let result = readAttribute(element, name)
    return result.complete ? result.value : nil
}

private func stringAttribute(_ element: AXUIElement, _ name: CFString, allowNonString: Bool = false) -> AXRead<String> {
    let result = readAttribute(element, name)
    guard let value = result.value else {
        return AXRead(value: "", present: false, complete: result.complete)
    }
    if let string = value as? String {
        return AXRead(value: string, present: true, complete: result.complete)
    }
    if let attributed = value as? NSAttributedString {
        return AXRead(value: attributed.string, present: true, complete: result.complete)
    }
    return AXRead(value: "", present: true, complete: result.complete && allowNonString)
}

private func boolAttribute(_ element: AXUIElement, _ name: CFString, fallback: Bool = false) -> AXRead<Bool> {
    let result = readAttribute(element, name)
    guard let value = result.value else {
        return AXRead(value: fallback, present: false, complete: result.complete)
    }
    if let boolean = value as? Bool {
        return AXRead(value: boolean, present: true, complete: result.complete)
    }
    if CFGetTypeID(value) == CFBooleanGetTypeID() {
        return AXRead(value: CFBooleanGetValue((value as! CFBoolean)), present: true, complete: result.complete)
    }
    return AXRead(value: fallback, present: true, complete: false)
}

private func elementsAttribute(_ element: AXUIElement, _ name: CFString) -> AXRead<[AXUIElement]> {
    let result = readAttribute(element, name)
    guard let value = result.value else {
        return AXRead(value: [], present: false, complete: result.complete)
    }
    guard let elements = value as? [AXUIElement] else {
        return AXRead(value: [], present: true, complete: false)
    }
    return AXRead(value: elements, present: true, complete: result.complete)
}

private func pointAttribute(_ element: AXUIElement, _ name: CFString) -> CGPoint? {
    guard let value = attribute(element, name), CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero
    guard AXValueGetType(value as! AXValue) == .cgPoint,
          AXValueGetValue(value as! AXValue, .cgPoint, &point) else { return nil }
    return point
}

private func sizeAttribute(_ element: AXUIElement, _ name: CFString) -> CGSize? {
    guard let value = attribute(element, name), CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
    var size = CGSize.zero
    guard AXValueGetType(value as! AXValue) == .cgSize,
          AXValueGetValue(value as! AXValue, .cgSize, &size) else { return nil }
    return size
}

private func elementAtPoint(_ application: NSRunningApplication, _ point: CGPoint) -> AXUIElement? {
    var element: AXUIElement?
    guard AXUIElementCopyElementAtPosition(
        applicationElement(application),
        Float(point.x),
        Float(point.y),
        &element
    ) == .success else { return nil }
    return element
}

private func element(_ element: AXUIElement, belongsTo ancestor: AXUIElement) -> Bool {
    var current: AXUIElement? = element
    for _ in 0..<6 {
        guard let value = current else { return false }
        if CFEqual(value, ancestor) { return true }
        guard let parent = attribute(value, kAXParentAttribute as CFString),
              CFGetTypeID(parent) == AXUIElementGetTypeID() else { return false }
        current = (parent as! AXUIElement)
    }
    return false
}

private func actionNames(_ element: AXUIElement) -> AXRead<[String]> {
    var names: CFArray?
    let error = AXUIElementCopyActionNames(element, &names)
    if error == .actionUnsupported {
        return AXRead(value: [], present: false, complete: true)
    }
    guard error == .success, let names = names as? [String] else {
        return AXRead(value: [], present: false, complete: false)
    }
    return AXRead(value: names, present: true, complete: true)
}

private func snapshot(_ element: AXUIElement) -> ElementSnapshot {
    let role = stringAttribute(element, kAXRoleAttribute as CFString)
    if role.value.isEmpty || role.value == "AXWebArea" || role.value == "AXDocument" {
        return ElementSnapshot(
            element: element,
            role: role.value,
            subrole: "",
            title: "",
            value: "",
            description: "",
            enabled: false,
            actions: [],
            readComplete: role.complete && role.present && !role.value.isEmpty
        )
    }
    let subrole = stringAttribute(element, kAXSubroleAttribute as CFString)
    let title = stringAttribute(element, kAXTitleAttribute as CFString)
    let value = stringAttribute(element, kAXValueAttribute as CFString, allowNonString: true)
    let description = stringAttribute(element, kAXDescriptionAttribute as CFString)
    let enabled = role.value == kAXButtonRole as String
        ? boolAttribute(element, kAXEnabledAttribute as CFString)
        : AXRead(value: false, present: false, complete: true)
    let actions = role.value == kAXButtonRole as String
        ? actionNames(element)
        : AXRead(value: [], present: false, complete: true)
    return ElementSnapshot(
        element: element,
        role: role.value,
        subrole: subrole.value,
        title: title.value,
        value: value.value,
        description: description.value,
        enabled: enabled.value,
        actions: actions.value,
        readComplete: role.complete && role.present && !role.value.isEmpty &&
            subrole.complete && title.complete && value.complete && description.complete && enabled.complete && actions.complete
    )
}

private func flatten(_ root: AXUIElement, maximumDepth: Int = 18, maximumNodes: Int = 4_000) -> (nodes: [ElementSnapshot], truncated: Bool, documentBoundaryPruned: Bool, complete: Bool) {
    var result: [ElementSnapshot] = []
    var queue: [(AXUIElement, Int)] = [(root, 0)]
    var visited: [CFHashCode: [AXUIElement]] = [:]
    var truncated = false
    var documentBoundaryPruned = false
    var complete = true
    while let (element, depth) = queue.first {
        if result.count >= maximumNodes {
            truncated = true
            break
        }
        queue.removeFirst()
        let key = CFHash(element)
        if visited[key, default: []].contains(where: { CFEqual($0, element) }) { continue }
        visited[key, default: []].append(element)
        let current = snapshot(element)
        result.append(current)
        complete = complete && current.readComplete
        if current.role == "AXWebArea" || current.role == "AXDocument" {
            documentBoundaryPruned = true
            continue
        }
        if current.role.isEmpty { continue }
        let children = elementsAttribute(element, kAXChildrenAttribute as CFString)
        complete = complete && children.complete
        if depth >= maximumDepth {
            if !children.value.isEmpty { truncated = true }
            continue
        }
        queue.append(contentsOf: children.value.map { ($0, depth + 1) })
    }
    return (result, truncated, documentBoundaryPruned, complete && !truncated)
}

private func presentText(_ values: [String]) -> [String] {
    values.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}

private func customContent(_ element: AXUIElement) -> CustomContentRead {
    let attribute = readAttribute(element, "AXCustomContent" as CFString)
    guard attribute.complete else {
        return CustomContentRead(present: false, decoded: false, evidence: [], text: [], readComplete: false)
    }
    guard attribute.present else {
        return CustomContentRead(present: false, decoded: true, evidence: [], text: [], readComplete: true)
    }
    if let contents = attribute.value as? [AXCustomContent] {
        let evidence = contents.map {
            CustomContentEvidence(label: $0.label, value: $0.value, source: "decoded")
        }
        return CustomContentRead(
            present: true,
            decoded: true,
            evidence: evidence,
            text: presentText(evidence.map(\.value)),
            readComplete: true
        )
    }
    guard let data = attribute.value as? Data else {
        return CustomContentRead(present: true, decoded: false, evidence: [], text: [], readComplete: true)
    }
    if let contents = try? NSKeyedUnarchiver.unarchivedObject(
           ofClasses: [NSArray.self, AXCustomContent.self, NSString.self, NSAttributedString.self, NSDictionary.self],
           from: data
       ) as? [AXCustomContent] {
        let evidence = contents.map { content in
            return CustomContentEvidence(
                label: content.label,
                value: content.value,
                source: "decoded"
            )
        }
        return CustomContentRead(
            present: true,
            decoded: true,
            evidence: evidence,
            text: presentText(evidence.map(\.value)),
            readComplete: true
        )
    }
    let evidence = ((try? PropertyListSerialization.propertyList(from: data, options: [], format: nil)) as? [String: Any])?["$objects"]
        .flatMap { $0 as? [Any] }?
        .enumerated()
        .compactMap { index, object in
            (object as? String).map {
                CustomContentEvidence(label: "$objects[\(index)]", value: $0, source: "fallback")
            }
        } ?? []
    return CustomContentRead(
        present: true,
        decoded: false,
        evidence: evidence,
        text: presentText(evidence.map(\.value)),
        readComplete: true
    )
}

private func runningApplication(_ options: Options) -> NSRunningApplication? {
    let expectedPath = URL(fileURLWithPath: options.executablePathPrefix).resolvingSymlinksInPath().standardizedFileURL.path
    return NSRunningApplication.runningApplications(withBundleIdentifier: options.bundleIdentifier).first { application in
        let executablePath = application.executableURL?.resolvingSymlinksInPath().standardizedFileURL.path ?? ""
        return application.isTerminated == false &&
            (options.processIdentifier == nil || application.processIdentifier == options.processIdentifier) &&
            (executablePath == expectedPath || executablePath.hasPrefix(expectedPath + "/"))
    }
}

private func applicationElement(_ application: NSRunningApplication) -> AXUIElement {
    let element = AXUIElementCreateApplication(application.processIdentifier)
    AXUIElementSetMessagingTimeout(element, 0.75)
    return element
}

private func targetWindows(_ application: NSRunningApplication) -> AXRead<[AXUIElement]> {
    let windows = elementsAttribute(applicationElement(application), kAXWindowsAttribute as CFString)
    return AXRead(value: windows.value, present: windows.present, complete: windows.complete && windows.present)
}

private struct TaskSpaceContext {
    let matches: Bool
    let complete: Bool
}

private func taskSpaceContext(_ application: NSRunningApplication, options: Options) -> TaskSpaceContext {
    let expected = options.windowTitle.trimmingCharacters(in: .whitespacesAndNewlines)
    let windows = targetWindows(application)
    var matches = false
    var complete = windows.complete
    windows.value.forEach { window in
        let title = stringAttribute(window, kAXTitleAttribute as CFString)
        complete = complete && title.complete
        if title.value.trimmingCharacters(in: .whitespacesAndNewlines).localizedCaseInsensitiveCompare(expected) == .orderedSame {
            matches = true
        }
        let tree = flatten(window, maximumDepth: 10, maximumNodes: 1_200)
        complete = complete && tree.complete
        if tree.nodes.contains(where: { node in
            [node.title, node.value, node.description].contains {
                $0.trimmingCharacters(in: .whitespacesAndNewlines).localizedCaseInsensitiveCompare(expected) == .orderedSame
            }
        }) { matches = true }
    }
    return TaskSpaceContext(matches: matches, complete: complete)
}

private struct DialogCandidate {
    let window: AXUIElement
    let root: AXUIElement
    let windowTitle: String
    let dialogTitle: String
    let nodes: [ElementSnapshot]
    let buttons: [ElementSnapshot]
    let text: [String]
    let customContent: CustomContentRead
    let hasTextField: Bool
    let treeTruncated: Bool
    let axReadComplete: Bool
}

private struct DialogScan {
    let candidates: [DialogCandidate]
    let applicationDialogCount: Int
    let complete: Bool
}

private func clickButtonCenter(_ candidate: DialogCandidate, application: NSRunningApplication, options: Options) -> Bool {
    if options.requireTaskSpaceContext {
        let context = taskSpaceContext(application, options: options)
        if !context.complete || !context.matches { return false }
    }
    guard application.activate(options: [.activateIgnoringOtherApps]) else { return false }
    guard AXUIElementPerformAction(candidate.window, kAXRaiseAction as CFString) == .success else { return false }
    Thread.sleep(forTimeInterval: 0.15)
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == application.processIdentifier else { return false }
    if options.requireTaskSpaceContext {
        let context = taskSpaceContext(application, options: options)
        if !context.complete || !context.matches { return false }
    }
    let active = dialogCandidates(application, options: options)
    guard active.complete,
          active.applicationDialogCount == 1,
          active.candidates.count == 1,
          active.candidates[0].axReadComplete,
          active.candidates[0].customContent.present,
          active.candidates[0].customContent.decoded,
          active.candidates[0].buttons.count == 1,
          active.candidates[0].buttons[0].enabled,
          active.candidates[0].buttons[0].actions.contains(kAXPressAction as String),
          !active.candidates[0].text.isEmpty,
          !active.candidates[0].hasTextField,
          !active.candidates[0].treeTruncated,
          !options.expectedFingerprint.isEmpty,
          dialogFingerprint(application, candidate: active.candidates[0], options: options) == options.expectedFingerprint,
          let position = pointAttribute(active.candidates[0].buttons[0].element, kAXPositionAttribute as CFString),
          let size = sizeAttribute(active.candidates[0].buttons[0].element, kAXSizeAttribute as CFString),
          size.width > 0,
          size.height > 0 else { return false }
    let center = CGPoint(x: position.x + size.width / 2, y: position.y + size.height / 2)
    guard let hit = elementAtPoint(application, center),
          element(hit, belongsTo: active.candidates[0].buttons[0].element),
          NSWorkspace.shared.frontmostApplication?.processIdentifier == application.processIdentifier else { return false }
    guard let source = CGEventSource(stateID: .hidSystemState),
          let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: center, mouseButton: .left),
          let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: center, mouseButton: .left) else { return false }
    down.postToPid(application.processIdentifier)
    Thread.sleep(forTimeInterval: 0.04)
    up.postToPid(application.processIdentifier)
    return true
}

private func expectedOriginFragment(_ value: String) -> String? {
    guard let components = URLComponents(string: value),
          let scheme = components.scheme?.lowercased(),
          scheme == "http" || scheme == "https",
          let host = components.host?.lowercased(),
          !host.isEmpty else { return nil }
    return components.port.map { host + ":" + String($0) } ?? host
}

private func dialogTitle(_ title: String, matchesOrigin origin: String) -> Bool {
    let escaped = NSRegularExpression.escapedPattern(for: origin)
    return title.range(
        of: "(^|[^A-Za-z0-9.-])" + escaped + "($|[^A-Za-z0-9.-])",
        options: [.regularExpression, .caseInsensitive]
    ) != nil
}

private func dialogCandidates(_ application: NSRunningApplication, options: Options) -> DialogScan {
    guard let origin = expectedOriginFragment(options.expectedURL) else {
        return DialogScan(candidates: [], applicationDialogCount: 0, complete: false)
    }
    let windows = targetWindows(application)
    var complete = windows.complete
    var applicationDialogs: [AXUIElement] = []
    let candidates = windows.value.flatMap { window in
        let windowTitle = stringAttribute(window, kAXTitleAttribute as CFString)
        let chrome = flatten(window)
        complete = complete && windowTitle.complete && chrome.complete
        let dialogs = chrome.nodes.filter { node in
            node.role == kAXGroupRole as String &&
                node.subrole == applicationDialogSubrole
        }
        dialogs.forEach { dialog in
            if !applicationDialogs.contains(where: { CFEqual($0, dialog.element) }) {
                applicationDialogs.append(dialog.element)
            }
        }
        return dialogs.filter { dialogTitle($0.title, matchesOrigin: origin) }.map { dialog in
            let tree = flatten(dialog.element, maximumDepth: 12, maximumNodes: 1_200)
            let buttons = tree.nodes.filter { $0.role == kAXButtonRole as String }
            let content = customContent(dialog.element)
            complete = complete && tree.complete && content.readComplete
            return DialogCandidate(
                window: window,
                root: dialog.element,
                windowTitle: windowTitle.value,
                dialogTitle: dialog.title,
                nodes: tree.nodes,
                buttons: buttons,
                text: presentText(
                    content.text +
                    tree.nodes.filter { textRoles.contains($0.role) }.flatMap { [$0.title, $0.value, $0.description] }
                ),
                customContent: content,
                hasTextField: tree.nodes.contains { editableRoles.contains($0.role) },
                treeTruncated: tree.truncated || tree.documentBoundaryPruned,
                axReadComplete: dialog.readComplete && windowTitle.complete && tree.complete && content.readComplete
            )
        }
    }.reduce(into: [DialogCandidate]()) { candidates, candidate in
        // Chromium exposes the same native modal under both its dedicated
        // dialog window and the browser window. AX equality identifies that
        // duplicate without collapsing two genuinely distinct dialogs.
        if let index = candidates.firstIndex(where: { CFEqual($0.root, candidate.root) }) {
            // The alias nested under the normal browser window is the reliable
            // action target while Ego's agent-control overlay is active. The
            // dedicated dialog-window alias may accept AXPress without closing.
            if candidates[index].windowTitle == candidates[index].dialogTitle && candidate.windowTitle != candidate.dialogTitle {
                candidates[index] = candidate
            }
            return
        }
        candidates.append(candidate)
    }
    if candidates.count <= 1 || options.windowTitle.isEmpty {
        return DialogScan(candidates: candidates, applicationDialogCount: applicationDialogs.count, complete: complete)
    }
    // The task-space label lives on a transient Ego control window while the
    // JavaScript dialog lives on a Chromium dialog window. Use the label only
    // when it can safely disambiguate multiple real candidates.
    let matching = candidates.filter { $0.windowTitle.localizedCaseInsensitiveContains(options.windowTitle) }
    return DialogScan(candidates: matching.count == 1 ? matching : candidates, applicationDialogCount: applicationDialogs.count, complete: complete)
}

private func dialogFingerprint(_ application: NSRunningApplication, candidate: DialogCandidate, options: Options) -> String {
    var canonical = ""
    func normalized(_ value: String) -> String {
        value.precomposedStringWithCanonicalMapping
    }
    func encoded(_ values: [String]) -> String {
        values.map { value in
            let normalizedValue = normalized(value)
            return "\(normalizedValue.utf8.count):\(normalizedValue)"
        }.joined()
    }
    func append(_ label: String, _ value: String) {
        canonical += encoded([label, value])
    }
    append("pid", String(application.processIdentifier))
    append("path", application.executableURL?.resolvingSymlinksInPath().standardizedFileURL.path ?? "")
    append("expectedUrl", options.expectedURL)
    append("taskSpaceLabel", options.windowTitle)
    append("dialogTitle", candidate.dialogTitle)
    append("customContentPresent", candidate.customContent.present ? "true" : "false")
    append("customContentDecoded", candidate.customContent.decoded ? "true" : "false")
    append("customContentCount", String(candidate.customContent.evidence.count))
    candidate.customContent.evidence.sorted {
        encoded([$0.label, $0.value]) < encoded([$1.label, $1.value])
    }.enumerated().forEach { index, evidence in
        append("customContent[\(index)].label", evidence.label)
        append("customContent[\(index)].value", evidence.value)
    }
    append("buttonCount", String(candidate.buttons.count))
    candidate.buttons.sorted {
        encoded([$0.role, $0.subrole, $0.title, $0.value, $0.description]) <
            encoded([$1.role, $1.subrole, $1.title, $1.value, $1.description])
    }.enumerated().forEach { index, button in
        append("button[\(index)].role", button.role)
        append("button[\(index)].subrole", button.subrole)
        append("button[\(index)].title", button.title)
        append("button[\(index)].value", button.value)
        append("button[\(index)].description", button.description)
    }
    append("hasTextField", candidate.hasTextField ? "true" : "false")
    append("dialogTextCount", String(candidate.text.count))
    candidate.text.sorted { normalized($0) < normalized($1) }.enumerated().forEach { index, value in
        append("dialogText[\(index)]", value)
    }
    let hash = canonical.utf8.reduce(UInt64(14_695_981_039_346_656_037)) {
        ($0 ^ UInt64($1)) &* UInt64(1_099_511_628_211)
    }
    return String(format: "fnv1a64:%016llx", hash)
}

private func isoDate() -> String {
    ISO8601DateFormatter().string(from: Date())
}

private func makeResult(options: Options, application: NSRunningApplication?, candidate: DialogCandidate?, candidateCount: Int = 0, scanComplete: Bool = false, status: String? = nil, clicked: Bool, detectedAt: String? = nil, closedAt: String? = nil, detail: String) -> DialogResult {
    DialogResult(
        status: status ?? (candidate == nil ? scanComplete ? "none" : "indeterminate" : clicked ? "acknowledged" : "observed"),
        bundleIdentifier: options.bundleIdentifier,
        processIdentifier: application?.processIdentifier,
        executablePath: application?.executableURL?.path,
        windowTitle: candidate?.windowTitle,
        dialogTitle: candidate?.dialogTitle,
        fingerprint: application.flatMap { application in
            candidate.map { dialogFingerprint(application, candidate: $0, options: options) }
        },
        candidateCount: candidateCount,
        dialogText: candidate?.text ?? [],
        buttonLabels: candidate?.buttons.compactMap {
            presentText([$0.title, $0.value, $0.description]).first
        } ?? [],
        axReadComplete: scanComplete,
        customContentPresent: candidate?.customContent.present ?? false,
        customContentDecoded: candidate?.customContent.decoded ?? true,
        customContent: candidate?.customContent.evidence ?? [],
        hasTextField: candidate?.hasTextField ?? false,
        treeTruncated: candidate?.treeTruncated ?? false,
        clicked: clicked,
        detectedAt: detectedAt,
        closedAt: closedAt,
        detail: detail
    )
}

@discardableResult
private func emit(_ result: DialogResult, outputPath: String) -> Bool {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    guard let data = try? encoder.encode(result) else {
        FileHandle.standardError.write(Data("terra-dialog-guard: failed to encode structured evidence.\n".utf8))
        return false
    }
    if !outputPath.isEmpty {
        do {
            try data.write(to: URL(fileURLWithPath: outputPath), options: .atomic)
        } catch {
            FileHandle.standardError.write(Data("terra-dialog-guard: failed to persist structured evidence: \(error.localizedDescription)\n".utf8))
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data("\n".utf8))
            return false
        }
    }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    return true
}

private func waitForClosedDialog(_ application: NSRunningApplication, options: Options, attempts: Int) -> (closed: Bool, last: DialogScan) {
    var consecutiveCompleteAbsences = 0
    var last: DialogScan?
    for _ in 0..<attempts {
        Thread.sleep(forTimeInterval: 0.1)
        let scan = dialogCandidates(application, options: options)
        last = scan
        if scan.complete && scan.applicationDialogCount == 0 {
            consecutiveCompleteAbsences += 1
            if consecutiveCompleteAbsences >= 3 { return (true, scan) }
            continue
        }
        consecutiveCompleteAbsences = 0
    }
    return (false, last ?? dialogCandidates(application, options: options))
}

private func inspect(options: Options, acknowledge: Bool) -> DialogResult {
    let trusted = options.promptForAccessibility
        ? AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
        : AXIsProcessTrusted()
    guard trusted else {
        return makeResult(
            options: options,
            application: nil,
            candidate: nil,
            status: "permission_required",
            clicked: false,
            detail: "macOS Accessibility permission is required."
        )
    }
    let standardizedPath = URL(fileURLWithPath: options.executablePathPrefix).resolvingSymlinksInPath().standardizedFileURL.path
    guard options.processIdentifier != nil,
          options.executablePathPrefix.hasPrefix("/"),
          standardizedPath != "/",
          !options.windowTitle.isEmpty,
          expectedOriginFragment(options.expectedURL) != nil else {
        return makeResult(
            options: options,
            application: nil,
            candidate: nil,
            status: "invalid_target",
            clicked: false,
            detail: "An exact Ego Lite PID, component-bounded managed app path, task-space label, and absolute HTTP(S) URL are required."
        )
    }
    guard let application = runningApplication(options) else {
        return makeResult(options: options, application: nil, candidate: nil, status: "target_missing", clicked: false, detail: "Target Ego Lite process is not running.")
    }
    let scan = dialogCandidates(application, options: options)
    guard let candidate = scan.candidates.first else {
        return makeResult(
            options: options,
            application: application,
            candidate: nil,
            scanComplete: scan.complete,
            status: scan.applicationDialogCount > 0 ? "indeterminate" : nil,
            clicked: false,
            detail: scan.complete && scan.applicationDialogCount == 0
                ? "No native application dialog is present in the target Ego Lite browser chrome."
                : scan.complete
                    ? "A native application dialog is present, but its title does not match the expected host; no button was pressed."
                : "Accessibility traversal was indeterminate; absence of a native dialog was not established."
        )
    }
    guard scan.candidates.count == 1 else {
        return makeResult(
            options: options,
            application: application,
            candidate: candidate,
            candidateCount: scan.candidates.count,
            scanComplete: scan.complete,
            status: "ambiguous",
            clicked: false,
            detectedAt: isoDate(),
            detail: "Multiple native dialogs match the target; no button was pressed."
        )
    }
    let detectedAt = isoDate()
    guard acknowledge else {
        return makeResult(options: options, application: application, candidate: candidate, candidateCount: 1, scanComplete: scan.complete, clicked: false, detectedAt: detectedAt, detail: "Native application dialog observed in browser chrome.")
    }
    let fingerprint = dialogFingerprint(application, candidate: candidate, options: options)
    guard !options.expectedFingerprint.isEmpty,
          options.expectedFingerprint == fingerprint else {
        return makeResult(
            options: options,
            application: application,
            candidate: candidate,
            candidateCount: 1,
            scanComplete: scan.complete,
            clicked: false,
            detectedAt: detectedAt,
            detail: options.expectedFingerprint.isEmpty
                ? "An expected dialog fingerprint from a prior inspection is required; no button was pressed."
                : "The current dialog fingerprint does not match the inspected evidence; no button was pressed."
        )
    }
    let context = options.requireTaskSpaceContext
        ? taskSpaceContext(application, options: options)
        : TaskSpaceContext(matches: true, complete: true)
    guard scan.complete,
          scan.applicationDialogCount == 1,
          candidate.axReadComplete,
          candidate.customContent.present,
          candidate.customContent.decoded,
          candidate.buttons.count == 1,
          candidate.buttons[0].enabled,
          candidate.buttons[0].actions.contains(kAXPressAction as String),
          !candidate.text.isEmpty,
          !candidate.hasTextField,
          !candidate.treeTruncated,
          context.complete,
          context.matches else {
        return makeResult(options: options, application: application, candidate: candidate, candidateCount: 1, scanComplete: scan.complete, clicked: false, detectedAt: detectedAt, detail: "Dialog evidence is incomplete or is not a verified single-button acknowledgement alert.")
    }
    // Chromium publishes the AX button slightly before its native action is
    // reliably wired. Re-observe after a short settling interval so a watcher
    // cannot report a successful AXPress that left the modal on screen.
    Thread.sleep(forTimeInterval: 0.25)
    let stable = dialogCandidates(application, options: options)
    let stableContext = options.requireTaskSpaceContext
        ? taskSpaceContext(application, options: options)
        : TaskSpaceContext(matches: true, complete: true)
    guard stable.complete,
          stable.applicationDialogCount == 1,
          stable.candidates.count == 1,
          stable.candidates[0].axReadComplete,
          stable.candidates[0].customContent.present,
          stable.candidates[0].customContent.decoded,
          stable.candidates[0].buttons.count == 1,
          stable.candidates[0].buttons[0].enabled,
          stable.candidates[0].buttons[0].actions.contains(kAXPressAction as String),
          !stable.candidates[0].text.isEmpty,
          !stable.candidates[0].hasTextField,
          !stable.candidates[0].treeTruncated,
          stableContext.complete,
          stableContext.matches,
          dialogFingerprint(application, candidate: stable.candidates[0], options: options) == options.expectedFingerprint else {
        return makeResult(options: options, application: application, candidate: stable.candidates.first ?? candidate, candidateCount: stable.candidates.count, scanComplete: stable.complete, clicked: false, detectedAt: detectedAt, detail: "Dialog evidence changed or became indeterminate before acknowledgement; no button was pressed.")
    }
    let axPressResult = AXUIElementPerformAction(stable.candidates[0].buttons[0].element, kAXPressAction as CFString)
    let afterAXPress = waitForClosedDialog(application, options: options, attempts: 10)
    if afterAXPress.closed {
        return makeResult(options: options, application: application, candidate: candidate, candidateCount: 1, scanComplete: true, clicked: true, detectedAt: detectedAt, closedAt: isoDate(), detail: "Single-button acknowledgement alert closed through AXPress after consecutive complete AX observations.")
    }
    if axPressResult != .success {
        return makeResult(options: options, application: application, candidate: afterAXPress.last.candidates.first ?? candidate, candidateCount: afterAXPress.last.candidates.count, scanComplete: afterAXPress.last.complete, clicked: false, detectedAt: detectedAt, detail: axPressResult == .cannotComplete ? "AXPress could not confirm completion; no coordinate click was attempted." : "The acknowledgement button rejected AXPress; no coordinate click was attempted.")
    }
    guard afterAXPress.last.complete,
          afterAXPress.last.applicationDialogCount == 1,
          afterAXPress.last.candidates.count == 1,
          afterAXPress.last.candidates[0].axReadComplete,
          afterAXPress.last.candidates[0].customContent.present,
          afterAXPress.last.candidates[0].customContent.decoded,
          afterAXPress.last.candidates[0].buttons.count == 1,
          afterAXPress.last.candidates[0].buttons[0].enabled,
          afterAXPress.last.candidates[0].buttons[0].actions.contains(kAXPressAction as String),
          !afterAXPress.last.candidates[0].text.isEmpty,
          !afterAXPress.last.candidates[0].hasTextField,
          !afterAXPress.last.candidates[0].treeTruncated,
          dialogFingerprint(application, candidate: afterAXPress.last.candidates[0], options: options) == options.expectedFingerprint,
          clickButtonCenter(afterAXPress.last.candidates[0], application: application, options: options) else {
        return makeResult(options: options, application: application, candidate: afterAXPress.last.candidates.first ?? candidate, candidateCount: afterAXPress.last.candidates.count, scanComplete: afterAXPress.last.complete, clicked: false, detectedAt: detectedAt, detail: "AXPress returned, but complete unchanged evidence for the verified coordinate fallback was unavailable.")
    }
    let afterClick = waitForClosedDialog(application, options: options, attempts: 10)
    if afterClick.closed {
        return makeResult(options: options, application: application, candidate: candidate, candidateCount: 1, scanComplete: true, clicked: true, detectedAt: detectedAt, closedAt: isoDate(), detail: "Single-button acknowledgement alert closed through a verified AX-coordinate click after consecutive complete AX observations.")
    }
    return makeResult(options: options, application: application, candidate: afterClick.last.candidates.first ?? candidate, candidateCount: afterClick.last.candidates.count, scanComplete: afterClick.last.complete, clicked: false, detectedAt: detectedAt, detail: "The verified coordinate click returned, but consecutive complete closure observations were unavailable.")
}

private let options = parseOptions()
if options.command == "watch" || options.command == "watch-and-acknowledge" {
    let baseline = inspect(options: options, acknowledge: false)
    if baseline.status != "none" || !baseline.axReadComplete {
        guard emit(baseline, outputPath: options.outputPath) else { exit(2) }
        exit(baseline.status == "observed" ? 0 : 2)
    }
    if !options.readyOutputPath.isEmpty {
        do {
            try Data("ready\n".utf8).write(to: URL(fileURLWithPath: options.readyOutputPath), options: .atomic)
        } catch {
            _ = emit(
                makeResult(
                    options: options,
                    application: runningApplication(options),
                    candidate: nil,
                    scanComplete: true,
                    status: "ready_output_failed",
                    clicked: false,
                    detail: "The complete no-dialog baseline was established, but the ready marker could not be written: \(error.localizedDescription)"
                ),
                outputPath: options.outputPath
            )
            exit(2)
        }
    }
    let deadline = Date().addingTimeInterval(Double(max(options.timeoutMilliseconds, 1)) / 1_000)
    repeat {
        let observed = inspect(options: options, acknowledge: false)
        if observed.status != "none" {
            // Persist evidence before a potentially slower acknowledgement so
            // the parent wrapper cannot lose the event while the browser round
            // is unwinding.
            guard emit(observed, outputPath: options.outputPath) else { exit(2) }
            if options.command == "watch-and-acknowledge", observed.status == "observed" {
                var acknowledgementOptions = options
                acknowledgementOptions.expectedFingerprint = observed.fingerprint ?? ""
                let resolved = inspect(options: acknowledgementOptions, acknowledge: true)
                // A browser helper may close the alert between observation and
                // acknowledgement. Preserve the first evidence in that race.
                if resolved.status == "acknowledged", resolved.fingerprint == observed.fingerprint {
                    guard emit(resolved, outputPath: options.outputPath) else { exit(2) }
                }
                exit(0)
            }
            exit(observed.status == "observed" ? 0 : 2)
        }
        Thread.sleep(forTimeInterval: 0.1)
    } while Date() < deadline
    let final = inspect(options: options, acknowledge: false)
    guard emit(final, outputPath: options.outputPath) else { exit(2) }
    exit(final.status == "none" || final.status == "observed" ? 0 : 2)
}

private let result = inspect(options: options, acknowledge: options.command == "acknowledge" || options.command == "ack")
guard emit(result, outputPath: options.outputPath) else { exit(2) }
exit(result.status == "permission_required" ? 3 : 0)
