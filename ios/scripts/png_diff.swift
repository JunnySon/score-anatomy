// 캡처 두 장(PNG)을 화소로 견준다(작업 지시서 4: 지난 캡처와 새 캡처가 같은지 볼 때 쓴다).
// 쓰는 법: swift ios/scripts/png_diff.swift <앞.png> <뒤.png> [문턱(채널 차이, 기본 8)]
// 출력 한 줄: 크기, 문턱을 넘는 화소 수, 그 화소들이 있는 사각형(화소 좌표). 크기가 다르면 그것만 적는다.
import CoreGraphics
import Foundation
import ImageIO

func load(_ path: String) -> (width: Int, height: Int, bytes: [UInt8])? {
    guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return nil }
    let width = image.width, height = image.height
    var bytes = [UInt8](repeating: 0, count: width * height * 4)
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    let ok = bytes.withUnsafeMutableBytes { buffer -> Bool in
        guard let context = CGContext(data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                      space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        return true
    }
    return ok ? (width, height, bytes) : nil
}

let args = CommandLine.arguments
guard args.count >= 3, let a = load(args[1]), let b = load(args[2]) else {
    print("읽지 못함")
    exit(2)
}
let threshold = args.count > 3 ? Int(args[3]) ?? 8 : 8
guard a.width == b.width, a.height == b.height else {
    print("크기 다름 \(a.width)x\(a.height) \(b.width)x\(b.height)")
    exit(1)
}
var count = 0
var minX = Int.max, minY = Int.max, maxX = -1, maxY = -1
for y in 0..<a.height {
    for x in 0..<a.width {
        let i = (y * a.width + x) * 4
        var worst = 0
        for c in 0..<3 {
            worst = max(worst, abs(Int(a.bytes[i + c]) - Int(b.bytes[i + c])))
        }
        if worst > threshold {
            count += 1
            minX = min(minX, x); minY = min(minY, y); maxX = max(maxX, x); maxY = max(maxY, y)
        }
    }
}
if count == 0 {
    print("크기 \(a.width)x\(a.height), 다른 화소 0")
} else {
    print("크기 \(a.width)x\(a.height), 다른 화소 \(count), 사각형 x \(minX)~\(maxX), y \(minY)~\(maxY)")
}
exit(count == 0 ? 0 : 1)
