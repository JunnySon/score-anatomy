// 캡처의 한 부분을 잘라 화소를 그대로(보간 없이) 키워 PNG 로 남긴다. 진행 막대의 둥근 끝과 표시 화면 아래 단서를
// 확대해서 보려고 쓴다(작업 지시서 3-2의 3-4 5번). verify.sh 가 아니라 사람이 문서를 쓸 때 돌린다.
//
// 쓰는 법: swift ios/scripts/zoom_crop.swift <원본.png> <x> <y> <폭> <높이> <배율> <출력.png>
// x, y, 폭, 높이는 원본의 화소 단위다(iPhone 17 캡처는 점 하나가 3화소).
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count == 8, let x = Int(args[2]), let y = Int(args[3]), let w = Int(args[4]), let h = Int(args[5]), let k = Int(args[6]), k >= 1 else {
    FileHandle.standardError.write(Data("쓰는 법: swift zoom_crop.swift 원본.png x y 폭 높이 배율 출력.png\n".utf8))
    exit(2)
}
let input = URL(fileURLWithPath: args[1])
let output = URL(fileURLWithPath: args[7])
guard let source = CGImageSourceCreateWithURL(input as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    FileHandle.standardError.write(Data("그림을 읽지 못함: \(input.path)\n".utf8))
    exit(1)
}
// cropping(to:) 은 사각형이 그림 밖으로 일부만 나가면 겹친 부분만 돌려준다. 그대로 키우면 가로세로 배율이 달라지므로 멈춘다.
guard x >= 0, y >= 0, w > 0, h > 0, x + w <= image.width, y + h <= image.height,
      let part = image.cropping(to: CGRect(x: x, y: y, width: w, height: h)), part.width == w, part.height == h else {
    FileHandle.standardError.write(Data("자를 자리가 그림(\(image.width)x\(image.height)) 밖으로 나가요\n".utf8))
    exit(1)
}
let space = CGColorSpace(name: CGColorSpace.sRGB)!
guard let context = CGContext(data: nil, width: w * k, height: h * k, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { exit(1) }
context.interpolationQuality = .none
context.draw(part, in: CGRect(x: 0, y: 0, width: w * k, height: h * k))
guard let big = context.makeImage(), let dest = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil) else { exit(1) }
CGImageDestinationAddImage(dest, big, nil)
exit(CGImageDestinationFinalize(dest) ? 0 : 1)
