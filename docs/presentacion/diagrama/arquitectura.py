"""Arquitectura de Expediente Rosa con diagrams.py.

    uv venv && uv pip install diagrams   # requiere Graphviz (brew install graphviz)
    python arquitectura.py               # genera ../arquitectura-diagrams.png
"""
import os

from diagrams import Cluster, Diagram, Edge
from diagrams.custom import Custom
from diagrams.generic.blank import Blank
from diagrams.onprem.client import Client, Users
from diagrams.onprem.container import Docker
from diagrams.programming.language import Nodejs, Swift

AQUI = os.path.dirname(os.path.abspath(__file__))
ROSA = "#C4006A"
GRIS = "#5B6270"

grafo = {
    "fontname": "Helvetica", "fontsize": "22", "bgcolor": "white", "pad": "0.6",
    "nodesep": "0.35", "ranksep": "0.9", "splines": "spline", "newrank": "true",
}
nodo = {"fontname": "Helvetica", "fontsize": "13"}
arista = {"fontname": "Helvetica", "fontsize": "12", "color": GRIS}


def caja(texto):
    """Nodo de solo texto para las estructuras de Valkey."""
    return Blank(texto, shape="box", style="rounded,filled", fillcolor="#FCE4EF", color=ROSA,
                 width="2.8", height="0.8", fontsize="12", labelloc="c", imagescale="false", fixedsize="true")


with Diagram("Expediente Rosa · arquitectura", filename="../arquitectura-diagrams", show=False,
             direction="LR", graph_attr=grafo, node_attr=nodo, edge_attr=arista, outformat="png"):

    with Cluster("Comunidad · sin señal hasta 3 días", graph_attr={"bgcolor": "#FCE4EF", "fontsize": "15", "fontname": "Helvetica"}):
        brigada = Users("Enfermería · Médico")
        with Cluster("iPhone · los datos de salud no salen del teléfono", graph_attr={"bgcolor": "white", "fontsize": "13", "fontname": "Helvetica"}):
            app = Custom("Expediente Rosa\nSwiftUI", os.path.join(AQUI, "app.png"))
            datos = Swift("SwiftData\ncola de eventos\ncon llave única")
            ia = Swift("Vision + Foundation Models\nleer hoja · explicar · dictar\ncoincidencias: Jaro-Winkler + fonética")
        brigada >> app
        app >> Edge(color=ROSA) >> [datos, ia]

    with Cluster("Servidor (Docker)", graph_attr={"bgcolor": "#F4F5F7", "fontsize": "15", "fontname": "Helvetica"}):
        docker = Docker("docker compose")
        api = Nodejs("API Hono\n/sync /buscar /resumen\n/patologia /jornadas")
        with Cluster("Valkey (valkey-bundle)", graph_attr={"bgcolor": "white", "fontsize": "13", "fontname": "Helvetica"}):
            valkey = Custom("Valkey", os.path.join(AQUI, "valkey.png"))
            estructuras = [
                caja("SET NX\nno duplica envíos"),
                caja("valkey-search (HNSW)\nnombres parecidos"),
                caja("Sorted sets\nduplicados · seguimiento\npatología · jornadas"),
                caja("Hashes con versión\n+ script Lua: conflictos"),
                caja("Stream\nbitácora sin datos clínicos"),
                caja("Pub/Sub\ntablero en vivo (SSE)"),
            ]
        docker - Edge(style="dotted", color=GRIS) - api
        api >> Edge(color=ROSA) >> valkey
        valkey - Edge(color="#C9CCD3", arrowhead="none") - estructuras

    with Cluster("Ciudad Guzmán · oficina", graph_attr={"bgcolor": "#F4F5F7", "fontsize": "15", "fontname": "Helvetica"}):
        oficina = Users("Coordinación · Patología")
        panel = Client("Panel web\ntablero · patología\nseguimiento · jornadas")
        oficina >> panel

    datos >> Edge(label="al volver la señal\nPOST /api/sync", color=ROSA, penwidth="2") >> api
    datos >> Edge(label="antes de salir\nGET /api/jornadas\n+ pacientes", style="dashed", color=GRIS, dir="both", arrowhead="none", arrowtail="normal") >> api
    api >> Edge(label="HTTP + SSE", color=GRIS, dir="both", arrowhead="none", arrowtail="normal") >> panel
