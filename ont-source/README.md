# OpenNutriTracker web build

Flutter web build (PWA) of OpenNutriTracker v2.5.0, intended to be served at /ad/ont/.
web-port.patch is the small change set applied on top of upstream to run on web.
Build: flutter build web --release --no-web-resources-cdn --base-href /ad/ont/ (Flutter 3.44.6, placeholder .env keys).
