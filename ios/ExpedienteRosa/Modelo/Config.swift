import Foundation

enum Config {
    /// URL de la API. Se cambia en Info.plist (API_URL) o en Ajustes con la llave "api_url".
    static var apiURL: URL {
        if let s = UserDefaults.standard.string(forKey: "api_url"), !s.isEmpty, let u = URL(string: s) { return u }
        #if targetEnvironment(simulator)
        let llave = "API_URL"               // el simulador llega a la Mac por localhost
        #else
        let llave = "API_URL_DISPOSITIVO"   // un iPhone/iPad real no: usa el servidor publicado
        #endif
        let s = Bundle.main.object(forInfoDictionaryKey: llave) as? String
            ?? Bundle.main.object(forInfoDictionaryKey: "API_URL") as? String ?? "http://localhost:8787/api"
        return URL(string: s)!
    }
    /// Identificador del teléfono para la bitácora de sincronización.
    static var dispositivo: String {
        if let d = UserDefaults.standard.string(forKey: "dispositivo") { return d }
        let d = "ios-" + UUID().uuidString.prefix(8).lowercased()
        UserDefaults.standard.set(d, forKey: "dispositivo")
        return d
    }

    /// Quién captura, para la bitácora: «Rocío (Enfermería)». Sin nombre: «Enfermería · a1b2».
    static var autor: String {
        let d = UserDefaults.standard
        let rol = Rol(rawValue: d.string(forKey: "rol") ?? "") ?? .enfermeria
        let nombre = (d.string(forKey: "nombre") ?? "").trimmingCharacters(in: .whitespaces)
        return nombre.isEmpty ? "\(rol.nombre) · \(dispositivo.suffix(4))" : "\(nombre) (\(rol.nombre))"
    }
}
