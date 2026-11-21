import SwiftUI

/// Arranque (~0.9 s). Empieza idéntico a la pantalla de lanzamiento estática
/// (UILaunchScreen: FondoArranque + LogoMarca a su tamaño natural), así no hay salto.
/// El logo crece con un resorte sin rebote y todo se desvanece hacia Buscar.
/// Con «Reducir movimiento» solo se desvanece.
struct Arranque: View {
    var alTerminar: () -> Void
    @Environment(\.accessibilityReduceMotion) private var sinMovimiento
    @State private var crece = false
    @State private var visible = true

    var body: some View {
        ZStack {
            Color("FondoArranque")
            Image("LogoMarca")
                .scaleEffect(crece ? 1.08 : 1)
                .accessibilityLabel("Expediente Rosa")
        }
        .ignoresSafeArea() // centrado en la pantalla completa, igual que la de lanzamiento
        .opacity(visible ? 1 : 0)
        .allowsHitTesting(visible)
        .task {
            if !sinMovimiento { withAnimation(.spring(response: 0.5, dampingFraction: 1)) { crece = true } }
            try? await Task.sleep(for: .milliseconds(550))
            withAnimation(.easeOut(duration: 0.35)) { visible = false }
            try? await Task.sleep(for: .milliseconds(350))
            alTerminar()
        }
    }
}
