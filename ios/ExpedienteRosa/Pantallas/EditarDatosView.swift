import SwiftUI

/// Enfermería corrige datos de la paciente. Solo viajan los campos que cambiaron;
/// si otro teléfono ya la cambió, la coordinadora decide en Revisión › Conflictos.
struct EditarDatosView: View {
    let paciente: Paciente
    @Environment(Sincronizador.self) private var sync
    @Environment(\.dismiss) private var cerrar
    @State private var nombre: String
    @State private var paterno: String
    @State private var materno: String
    @State private var nacimiento: String
    @State private var edad: String
    @State private var comunidad: String
    @State private var municipio: String
    @State private var entidad: String
    @State private var idEira: String
    @State private var error: String?
    @State private var guardado = false

    init(paciente: Paciente) {
        self.paciente = paciente
        _nombre = State(initialValue: paciente.nombre)
        _paterno = State(initialValue: paciente.apellidoPaterno)
        _materno = State(initialValue: paciente.apellidoMaterno ?? "")
        _nacimiento = State(initialValue: paciente.nacimiento ?? "")
        _edad = State(initialValue: paciente.edad.map(String.init) ?? "")
        _comunidad = State(initialValue: paciente.comunidad)
        _municipio = State(initialValue: paciente.municipio ?? "")
        _entidad = State(initialValue: paciente.entidadNacimiento ?? "")
        _idEira = State(initialValue: paciente.idEira ?? "")
    }

    /// Campos distintos a los guardados. Un campo vaciado no viaja: la API no deja borrar.
    private var cambios: [String: ValorCampo] {
        var c: [String: ValorCampo] = [:]
        func texto(_ k: String, _ nuevo: String, _ viejo: String?) {
            let n = nuevo.limpio
            if !n.isEmpty, n != (viejo ?? "") { c[k] = .texto(n) }
        }
        texto("nombre", nombre, paciente.nombre)
        texto("apellidoPaterno", paterno, paciente.apellidoPaterno)
        texto("apellidoMaterno", materno, paciente.apellidoMaterno)
        texto("nacimiento", nacimiento, paciente.nacimiento)
        texto("comunidad", comunidad, paciente.comunidad)
        texto("municipio", municipio, paciente.municipio)
        texto("entidadNacimiento", entidad, paciente.entidadNacimiento)
        texto("idEira", idEira, paciente.idEira)
        if let n = Int(edad.limpio), n != paciente.edad { c["edad"] = .numero(n) }
        return c
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Nombre") {
                    campo("Nombre", $nombre)
                    campo("Apellido paterno", $paterno)
                    campo("Apellido materno", $materno)
                }
                Section {
                    campo("Nacimiento", $nacimiento, ayuda: "AAAA-MM-DD", teclado: .numbersAndPunctuation)
                    campo("Edad", $edad, teclado: .numberPad)
                    campo("Entidad de nacimiento", $entidad)
                    campo("Comunidad", $comunidad)
                    campo("Municipio", $municipio)
                    campo("ID EIRA", $idEira, mayusculas: true)
                } footer: {
                    Text("Solo se mandan los campos que cambies.")
                }
                if let error {
                    Section { Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Tema.rojo) }
                }
            }
            .navigationTitle("Editar datos")
            .navigationBarTitleDisplayMode(.inline)
            .tint(Tema.rosa)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { cerrar() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(cambios.isEmpty ? "Sin cambios" : "Guardar", action: guardar).disabled(cambios.isEmpty)
                }
            }
            .sensoryFeedback(.success, trigger: guardado)
            #if DEBUG
            .onAppear {
                if ModoCaptura.pantalla == "editar", idEira.isEmpty { idEira = "EIRA-0142"; entidad = "Oaxaca" }
            }
            #endif
        }
    }

    private func campo(_ titulo: String, _ texto: Binding<String>, ayuda: String = "",
                       teclado: UIKeyboardType = .default, mayusculas: Bool = false) -> some View {
        LabeledContent(titulo) {
            TextField(ayuda, text: texto)
                .multilineTextAlignment(.trailing)
                .keyboardType(teclado)
                .textInputAutocapitalization(mayusculas ? .characters : .words)
                .autocorrectionDisabled()
        }
        .frame(minHeight: Tema.toque)
    }

    private func guardar() {
        do {
            try sync.repositorio.actualizar(paciente, campos: cambios)
            guardado = true
            cerrar()
        } catch {
            withAnimation(Tema.resorte) { self.error = error.localizedDescription }
        }
    }
}

/// Nombre legible de un campo de la paciente (bitácora y conflictos).
enum CampoPaciente {
    static func nombre(_ k: String) -> String {
        switch k {
        case "nombre": "Nombre"
        case "apellidoPaterno": "Apellido paterno"
        case "apellidoMaterno": "Apellido materno"
        case "nacimiento": "Nacimiento"
        case "edad": "Edad"
        case "comunidad": "Comunidad"
        case "municipio": "Municipio"
        case "entidadNacimiento": "Entidad de nacimiento"
        case "idEira": "ID EIRA"
        default: k
        }
    }
}
