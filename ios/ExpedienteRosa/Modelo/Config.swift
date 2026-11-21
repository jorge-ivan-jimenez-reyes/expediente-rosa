import Foundation

enum Config {
    /// URL de la API. Se cambia en Info.plist (API_URL) o en Ajustes con la llave "api_url".
    static var apiURL: URL {
        if let s = UserDefaults.standard.string(forKey: "api_url"), let u = URL(string: s) { return u }
        let s = Bundle.main.object(forInfoDictionaryKey: "API_URL") as? String ?? "http://localhost:8787/api"
        return URL(string: s)!
    }
    /// Identificador del teléfono para la bitácora de sincronización.
    static var dispositivo: String {
        if let d = UserDefaults.standard.string(forKey: "dispositivo") { return d }
        let d = "ios-" + UUID().uuidString.prefix(8).lowercased()
        UserDefaults.standard.set(d, forKey: "dispositivo")
        return d
    }
}
