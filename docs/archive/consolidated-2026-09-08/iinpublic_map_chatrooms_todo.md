# Map View for IinPublic Chatrooms

Status: implemented. PMTiles/Protomaps remains an explicitly deferred follow-up.

## Goal

Add a map as an alternative, more visible way to discover and open
existing IinPublic chatrooms.

The map is **not** intended to turn IinPublic into a navigation or
mapping application. It is simply another visualization of the same
chatroom data that is already available through the normal chatroom/list
UI.

## Proposed Architecture

Use an open-source mapping stack rather than depending on Google Maps or
Apple Maps.

Recommended initial stack:

-   **MapLibre GL JS** --- map rendering in the IinPublic web
    application.
-   **OpenStreetMap (OSM)** --- underlying geographic/map data.
-   Use an appropriate OSM-compatible tile provider initially; do not
    depend on the public OpenStreetMap tile servers for production-scale
    traffic.
-   Consider **PMTiles / Protomaps** later if self-hosted or offline map
    delivery becomes useful.

Conceptually:

    IinPublic Chatrooms
            |
            +-- List View
            |
            +-- Map View
                    |
                    v
               MapLibre
                    |
                    v
             OSM-based map

## Chatroom Data Model

Do **not** create a separate type of map chatroom.

Location should be optional metadata on the existing chatroom object.

Example:

    Chatroom
      - id
      - name
      - existing chatroom properties...
      - location (optional)
          - latitude
          - longitude

Both list view and map view should operate on the same underlying
chatroom objects.

## Initial Map Behavior

-   Add a **Map View** alongside the existing chatroom/list view.
-   Display chatrooms with locations as markers on the map.
-   A marker should identify the corresponding chatroom.
-   Clicking/tapping a marker should open or enter the existing
    chatroom.
-   Chatrooms without geographic metadata should continue to work
    normally and simply not appear on the map.
-   Do not add routing, navigation, directions, business search, or
    geocoding unless a future use case requires them.

## Scaling / Visibility

As the number of chatrooms increases, use MapLibre's GeoJSON and marker
clustering support.

At a wide zoom level, nearby chatrooms can appear as clusters:

    ● 37       ● 128       ● 54

As the user zooms in, clusters separate into individual chatrooms:

    📍 Coffee discussion
    📍 Neighborhood news
    📍 Hiking group
    📍 Used bicycles
    📍 Local events

This should make geographic chatrooms significantly easier to discover
than through a list alone.

## Implementation Status

1.  [x] Add an E2E test for the map-view behavior before implementing the
    application feature.
2.  [x] Add MapLibre GL JS to the application. It is lazy-loaded only when Map
    view is opened; Leaflet and its type package were removed.
3.  [x] Add optional latitude/longitude metadata to chatrooms. Custom-room API
    creation, listing, detail, and update paths validate and preserve public
    room-level coordinates.
4.  [x] Convert geographically located chatrooms into a typed GeoJSON source
    for MapLibre.
5.  [x] Add a Tree / Map view switch to the chatroom discovery UI.
6.  [x] Render accessible, keyboard-focusable chatroom markers.
7.  [x] Verify clicking/tapping a marker opens the correct existing chatroom.
8.  [x] Add MapLibre GeoJSON clustering for dense areas. Cluster controls zoom
    to their expansion level.
9.  [x] Verify chatrooms without locations continue to behave normally in Tree
    view and do not appear as map markers.
10. [x] Use the OSM-based OpenFreeMap Liberty vector style as the initial
    production source instead of public `tile.openstreetmap.org`. Deployments
    can override it with `IINPUBLIC_MAP_STYLE_URL`, including a self-hosted
    MapLibre-compatible style.
11. [ ] Later evaluate PMTiles/Protomaps if offline, self-hosted, or
    decentralized map distribution becomes useful.

The map source contains chatroom metadata and public room coordinates only. It
does not accept member or user coordinates.

## Design Principle

Keep the map feature small and modular:

> **List view:** What chatrooms are available?\
> **Map view:** Where are those chatrooms?

The map is a presentation/discovery layer over existing IinPublic
chatrooms, not a new chatroom system and not a replacement for a full
mapping/navigation service.
