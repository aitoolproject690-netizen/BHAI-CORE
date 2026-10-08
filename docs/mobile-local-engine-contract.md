# Mobile local generative engine contract

BHAI-CORE now exposes authenticated mobile engine discovery and selection, and can route image/video generation requests through the secure Mobile Node when a local engine is connected.

The phone-side engine is intentionally capability-advertised by the authenticated node. A disconnected node clears its advertised engines so stale GPU availability cannot be selected.
