# Studi-Watch
Schaue Online-Medien wie Videos, YouTube oder Audio gemeinsam mit deinen Freunden in privaten Räumen.
Generiere dazu einfach einen eigenen Raum und lade deine Freunde mit dem Link zum Raum ein.
Teste es doch einfach mal auf [https://watch.agent77326.de/](https://watch.agent77326.de/).

# Haupt-Features
- Play-/Pause- und Seek-Events werden mit allen Teilnehmern synchronisiert
- Chat Funktion mit momentan einer Befehlsfunktion
- Keine Werbung, kein Tracking, keine Daten auf dem Server (nur temporär die Client-Id)
Alles wird zwischen den Teilnehmern gesyncht und der Server fungiert als reiner Dummy
- Hot-Swap, Teilnehmer treten automatisch ihrem Raum wieder bei, falls der Server neugestartet wird.
Während eines Neustarts können natürlich keine Nachrichten übertragen werden
- 160 verschiendene Icons von [Icons8](https://icons8.com/) für den Chat zur Auswahl
- Beim Joinen wird von den anderen Teilnehmern automatisch das aktuelle Video, der Fortschritt sowie der Chat-Verlauf geholt

# Chat-Befehle
- `!play [url]` spielt die Ressource in <code>[url]</code> ab

# Unterstützte Medien-Formate
- Youtube-Videos im Format von `https://www.youtube.com/watch?v=[VIDEO_ID]` sowie `https://youtu.be/[VIDEO_ID]`
- Direkt verlinkte Audio-Dateien wie beispielsweise `https://example.com/[...]/audio.mp3` oder `[...]/audio.wav`
- Direkt verlinkte Video-Dateien wie beispielsweise `https://example.com/[...]/video.mp4` oder `[...]/video.webm`

# Bekannte Probleme
- Die Autoplay-Policies der Browser erzwingen meistens eine vorherige Interaktion mit dem Video-Element
- Bei Youtube wird das Video nicht mehr synchron abgespielt, falls die Abspielrate geändert wird
- Youtube forciert das Abspielen ab der Stelle deiner History
- Der Chat ist gefährlich... pass also auf mit wem du in einem Raum bist
