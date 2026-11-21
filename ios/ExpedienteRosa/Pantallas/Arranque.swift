import SwiftUI

/// Arranque (1.6 s). Empieza idéntico a la pantalla de lanzamiento estática
/// (UILaunchScreen: FondoArranque + LogoMarca a su tamaño natural), así no hay salto.
/// La mascota es el mismo expediente: la silueta del logo se funde en su cara, salta y saluda,
/// y todo se desvanece hacia Buscar. Con «Reducir movimiento» la cara aparece con la mano
/// arriba, sin salto, y se desvanece.
struct Arranque: View {
    var alTerminar: () -> Void
    @Environment(\.accessibilityReduceMotion) private var sinMovimiento
    @State private var cara = false
    @State private var visible = true

    /// El logo mide 160 pt de ancho; la mascota dibuja el expediente al 80 % de su cuadro.
    private static let anchoLogo: CGFloat = 160

    var body: some View {
        ZStack {
            Color("FondoArranque")
            ZStack {
                Image("LogoMarca")
                    .opacity(cara ? 0 : 1)
                Mascota(estado: cara ? .saluda : .reposo, tamano: Self.anchoLogo / 0.8, sobreRosa: true)
                    .opacity(cara ? 1 : 0)
            }
            .accessibilityElement()
            .accessibilityLabel("Expediente Rosa")
            VStack(spacing: 6) {
                Spacer()
                Text("Para").font(.footnote.weight(.medium)).foregroundStyle(.white.opacity(0.85))
                Image("LogoEIRA")
                    .resizable().renderingMode(.template).scaledToFit()
                    .frame(height: 34)
                    .foregroundStyle(.white)
                    .accessibilityLabel("EIRA Movimiento Rosa")
                Text("Movimiento Rosa A.C.").font(.caption).foregroundStyle(.white.opacity(0.85))
            }
            .padding(.bottom, 64)
            .opacity(cara || sinMovimiento ? 1 : 0)
        }
        .ignoresSafeArea() // centrado en la pantalla completa, igual que la de lanzamiento
        .opacity(visible ? 1 : 0)
        .allowsHitTesting(visible)
        .task {
            // 0–0.12 s: igual al lanzamiento. 0.12–0.30: la silueta se vuelve cara y empieza el saludo.
            try? await Task.sleep(for: .milliseconds(120))
            withAnimation(.easeOut(duration: 0.18)) { cara = true }
            // El saludo dura ~1.1 s; a 1.25 s empieza a irse.
            try? await Task.sleep(for: .milliseconds(1130))
            withAnimation(.easeOut(duration: 0.35)) { visible = false }
            try? await Task.sleep(for: .milliseconds(350))
            alTerminar()
        }
    }
}
