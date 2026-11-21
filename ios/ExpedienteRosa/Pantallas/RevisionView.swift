import SwiftUI

/// La coordinadora revisa lo que el servidor no decide solo: posibles duplicados
/// (dos teléfonos registraron a la misma señora), correcciones en conflicto y anormales sin atender.
struct RevisionView: View {
    enum Seccion: String, CaseIterable, Identifiable {
        case duplicados = "Duplicados", conflictos = "Conflictos", seguimiento = "Seguimiento"
        var id: String { rawValue }
    }

    @Environment(Sincronizador.self) private var sync
    @AppStorage("rol") private var rol: Rol = .enfermeria
    @State var seccion: Seccion = .duplicados
    @State private var pares: [ParDuplicado] = []
    @State private var conflictos: [ConflictoDTO] = []
    @State private var seguimiento: [SeguimientoDTO] = []
    @State private var cargando = false
    @State private var error: String?
    @State private var resueltos = 0
    @State private var ruta: [String] = []

    var body: some View {
        NavigationStack(path: $ruta) {
            ScrollView {
                VStack(spacing: Tema.Espacio.l) {
                    Picker("Sección", selection: $seccion) {
                        ForEach(Seccion.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    if vacio && !cargando { sinNada }
                    switch seccion {
                    case .duplicados:
                        ForEach(pares) { par in
                            TarjetaPar(par: par) { unir in Task { await resolver(par, unir: unir) } }
                                .transition(.asymmetric(insertion: .opacity, removal: .move(edge: .leading).combined(with: .opacity)))
                        }
                    case .conflictos:
                        ForEach(conflictos) { c in
                            TarjetaConflicto(conflicto: c) { aceptar in Task { await resolver(c, aceptar: aceptar) } }
                                .transition(.asymmetric(insertion: .opacity, removal: .move(edge: .leading).combined(with: .opacity)))
                        }
                    case .seguimiento:
                        if !seguimiento.isEmpty { ListaSeguimiento(filas: seguimiento) }
                    }
                }
                .padding(Tema.Espacio.l)
                .animation(Tema.resorte, value: pares.map(\.id))
                .animation(Tema.resorte, value: conflictos.map(\.id))
            }
            .background(Tema.fondo)
            .navigationTitle("Revisión")
            .navigationDestination(for: String.self) { _ in BitacoraView() }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { SelectorRol() }
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink(value: "bitacora") { Label("Bitácora", systemImage: "list.bullet.rectangle") }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if cargando { ProgressView() } else {
                        Button { Task { await cargar() } } label: { Label("Actualizar", systemImage: "arrow.clockwise") }
                    }
                }
            }
            .refreshable { await cargar() }
            .task(id: seccion) { await cargar() }
            .sensoryFeedback(.success, trigger: resueltos)
            #if DEBUG
            .onAppear {
                seccion = ModoCaptura.seccionRevision
                if ModoCaptura.pantalla == "bitacora" { ruta = ["bitacora"] }
            }
            #endif
        }
    }

    private var vacio: Bool {
        switch seccion {
        case .duplicados: pares.isEmpty
        case .conflictos: conflictos.isEmpty
        case .seguimiento: seguimiento.isEmpty
        }
    }

    private var sinNada: some View {
        let texto: String = switch seccion {
        case .duplicados: "Aquí aparecen las pacientes que dos teléfonos registraron por separado."
        case .conflictos: "Aquí aparecen las correcciones que chocaron con un cambio de otro teléfono."
        case .seguimiento: "Ningún estudio anormal espera atención."
        }
        return ContentUnavailableView {
            Label(error == nil ? "Nada por revisar" : "Sin conexión", systemImage: error == nil ? "checkmark.circle" : "wifi.exclamationmark")
        } description: {
            Text(error ?? texto)
        }
        .padding(.top, 40)
    }

    private func cargar() async {
        #if DEBUG
        if ModoCaptura.pantalla != nil {
            pares = ModoCaptura.paresDemo; conflictos = ModoCaptura.conflictosDemo; seguimiento = ModoCaptura.seguimientoDemo
            return
        }
        #endif
        cargando = true; error = nil
        do {
            switch seccion {
            case .duplicados: pares = try await sync.api.duplicados()
            case .conflictos: conflictos = try await sync.api.conflictos()
            case .seguimiento: seguimiento = try await sync.api.seguimiento()
            }
        } catch {
            self.error = error.localizedDescription
        }
        cargando = false
    }

    private var enCaptura: Bool {
        #if DEBUG
        ModoCaptura.pantalla != nil
        #else
        false
        #endif
    }

    private func resolver(_ par: ParDuplicado, unir: Bool) async {
        do {
            if !enCaptura { try await sync.api.resolver(par, unir: unir) }
            withAnimation(Tema.resorte) { pares.removeAll { $0.id == par.id } }
            resueltos += 1
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func resolver(_ c: ConflictoDTO, aceptar: Bool) async {
        do {
            if !enCaptura { try await sync.api.resolverConflicto(id: c.id, aceptar: aceptar, autor: sync.autor) }
            withAnimation(Tema.resorte) { conflictos.removeAll { $0.id == c.id } }
            resueltos += 1
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Una corrección que llegó con una versión vieja: lo que hay hoy contra lo que propone.
struct TarjetaConflicto: View {
    var conflicto: ConflictoDTO
    var decidir: (Bool) -> Void

    var body: some View {
        Tarjeta {
            VStack(alignment: .leading, spacing: Tema.Espacio.xs) {
                Text(conflicto.paciente?.nombreCompleto ?? "Paciente no encontrada").font(.seccion)
                Text(subtitulo).font(.nota).foregroundStyle(.secondary)
            }
            VStack(spacing: Tema.Espacio.m) {
                ForEach(conflicto.campos, id: \.campo) { c in
                    VStack(alignment: .leading, spacing: Tema.Espacio.xs) {
                        Text(CampoPaciente.nombre(c.campo)).font(.nota).foregroundStyle(.secondary)
                        HStack(alignment: .firstTextBaseline, spacing: Tema.Espacio.s) {
                            Text(c.actual?.description ?? "—")
                                .font(.cuerpo)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Image(systemName: "arrow.right").font(.nota).foregroundStyle(.secondary)
                                .accessibilityLabel("cambia a")
                            Text(c.propuesto?.description ?? "—")
                                .font(.cuerpo.weight(.semibold)).foregroundStyle(Tema.rosa)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .accessibilityElement(children: .combine)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.vertical, Tema.Espacio.xs)
            Renglon {
                Button { decidir(false) } label: {
                    Text("Rechazar").font(.seccion).frame(maxWidth: .infinity, minHeight: Tema.toque)
                }
                .buttonStyle(.glass)
                .tint(Tema.rosa)
                Button { decidir(true) } label: {
                    Text("Aceptar").font(.seccion).frame(maxWidth: .infinity, minHeight: Tema.toque)
                }
                .buttonStyle(.glassProminent)
                .tint(Tema.rosaRelleno)
                .disabled(conflicto.paciente == nil)
            }
        }
    }

    private var subtitulo: String {
        let cuando = Fechas.leer(conflicto.creado)?.formatted(.relative(presentation: .named)) ?? ""
        return [conflicto.paciente?.folio, "lo cambió \(conflicto.autor)", cuando].compactMap { $0 }
            .filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

/// Anormales sin atender, vencidos primero (el servidor ya los manda en ese orden).
struct ListaSeguimiento: View {
    var filas: [SeguimientoDTO]

    var body: some View {
        Tarjeta(espacio: 0) {
            Text("Sin atender").font(.seccion).padding(.bottom, Tema.Espacio.s)
            ForEach(Array(filas.enumerated()), id: \.element.id) { i, f in
                if i > 0 { Divider() }
                HStack(alignment: .center, spacing: Tema.Espacio.m) {
                    VStack(alignment: .leading, spacing: Tema.Espacio.xs) {
                        Text(f.paciente.nombreCompleto).font(.cuerpo.weight(.semibold))
                        Text(detalle(f)).font(.nota).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: Tema.Espacio.s)
                    plazo(f)
                }
                .padding(.vertical, Tema.Espacio.m)
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func detalle(_ f: SeguimientoDTO) -> String {
        [TipoEstudio(rawValue: f.tipo)?.nombre ?? f.tipo, f.motivo, f.paciente.comunidad].compactMap { $0 }.joined(separator: " · ")
    }

    private func plazo(_ f: SeguimientoDTO) -> some View {
        let d = abs(f.diasRestantes)
        return f.vencido
            ? Chip(texto: "Venció hace \(d) d", icono: "exclamationmark.triangle.fill", color: Tema.rojo)
            : Chip(texto: "Faltan \(d) d", icono: "clock.fill", color: Tema.ambar)
    }
}

struct TarjetaPar: View {
    var par: ParDuplicado
    var decidir: (Bool) -> Void

    var body: some View {
        Tarjeta {
            HStack(alignment: .top, spacing: Tema.Espacio.m) {
                AnilloPuntaje(puntaje: par.puntaje)
                VStack(alignment: .leading, spacing: Tema.Espacio.xs) {
                    Text("¿Es la misma persona?").font(.seccion)
                    Text(par.razones.capitalizandoPrimera).font(.nota).foregroundStyle(.secondary)
                }
            }
            HStack(alignment: .top, spacing: Tema.Espacio.m) {
                ficha(par.a, contra: par.b)
                Rectangle().fill(Tema.linea).frame(width: 1)
                ficha(par.b, contra: par.a)
            }
            .padding(.vertical, Tema.Espacio.xs)
            Renglon {
                Button { decidir(false) } label: {
                    Text("Son distintas").font(.seccion).frame(maxWidth: .infinity, minHeight: Tema.toque)
                }
                .buttonStyle(.glass)
                .tint(Tema.rosa)
                Button { decidir(true) } label: {
                    Text("Unir").font(.seccion).frame(maxWidth: .infinity, minHeight: Tema.toque)
                }
                .buttonStyle(.glassProminent)
                .tint(Tema.rosaRelleno)
            }
        }
    }

    /// Ficha de una paciente; lo que difiere de la otra va en rosa y negritas.
    private func ficha(_ p: PacienteDTO?, contra o: PacienteDTO?) -> some View {
        VStack(alignment: .leading, spacing: Tema.Espacio.xs) {
            if let p {
                campo(p.nombre, o?.nombre)
                campo(p.apellidoPaterno, o?.apellidoPaterno)
                campo(p.apellidoMaterno ?? "—", o?.apellidoMaterno ?? "—")
                campo(Self.edad(p), o.map(Self.edad))
                campo(p.comunidad, o?.comunidad)
                Text(p.folio).font(.nota.monospaced()).foregroundStyle(.secondary).padding(.top, Tema.Espacio.xs)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private static func edad(_ p: PacienteDTO) -> String {
        if let n = p.nacimiento, let f = FechasIA.fecha(n) { return f.formatted(.dateTime.day().month(.abbreviated).year()) }
        return p.edad.map { "\($0) años" } ?? "—"
    }

    private func campo(_ valor: String, _ otro: String?) -> some View {
        let distinto = valor.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
            != (otro ?? "").folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
        return Text(valor)
            .font(.cuerpo.weight(distinto ? .semibold : .regular))
            .foregroundStyle(distinto ? Tema.rosa : .primary)
    }
}
