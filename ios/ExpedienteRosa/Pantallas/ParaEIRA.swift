import SwiftUI

/// Pie discreto: la app se hizo para el reto de EIRA Movimiento Rosa A.C.
struct ParaEIRA: View {
    var body: some View {
        VStack(spacing: Tema.Espacio.xs) {
            Image("LogoEIRA")
                .resizable().renderingMode(.template).scaledToFit()
                .frame(height: 22)
                .foregroundStyle(Tema.rosa)
                .accessibilityLabel("EIRA Movimiento Rosa")
            Text("Hecho para EIRA Movimiento Rosa A.C.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}
