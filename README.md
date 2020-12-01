# Studi-Watch
Schaue Online-Medien wie Videos, YouTube oder Audio gemeinsam mit deinen Freunden in privaten Räumen.
Generiere dazu einfach einen eigenen Raum und lade deine Freunde mit dem Link zum Raum ein.
Teste es doch einfach mal auf [https://watch.agent77326.de/](https://watch.agent77326.de/).

# Haupt-Features
- Play-/Pause- und Seek-Events werden mit allen Teilnehmern synchronisiert
- Hot-Swap, Teilnehmer treten automatisch ihrem Raum wieder bei, falls der Server neugestartet wird.
Während eines Neustarts können natürlich keine Nachrichten übertragen werden
- 160 verschiedene Icons von [Icons8](https://icons8.com/) zur Auswahl
- Spiele ein zufälliges Musikvideo mit einem Mausklick ab
- Beim Joinen wird automatisch das aktuelle Video, der Fortschritt sowie der Chat-Verlauf geholt

# Unterstützte Medien-Formate
- Youtube-/Vimeo-Videos werden unterstützt, einfach den Link zur Seite einfügen
- Alle Mediendateien, welche direkt im Browser abgespielt werden können (ohne embed)

# Bekannte Probleme
- Das "Seeken" während der Player pausiert ist, wird nicht korrekt übermittelt/ausgeführt.
Es ist ein manueller Play/Pause Befehl erneut nötig (von dem Teilnehmer, welcher die Zeit festlegen will).
- Wenn der Tab nicht mehr im Vordergrund ist, verhindern einige Browser den Autoplay, wenn der Ton aktiviert ist und ein neues Video abgespielt wird.

# Setup
Am Einfachsten ist die Ausführung mit docker via `docker run -p 8881:8881 yasamato/studi-watch`.

## Manueller Start
Zum Starten reicht es einmal `npm run install` sowie `npm run start` auszuführen.
Es empfiehlt sich das Programm, als service zu registrieren oder beispielsweise via
`screen -S watch npm run start` im Hintergrund laufen zu lassen.

Standardmäßig wird der Port 8081 verwendet.

Wenn der Server hinter einem Reverse-Proxy-Server laufen soll, empfiehlt sich für Apache folgende Mindestkonfiguration:
```
<VirtualHost *:80>
    ServerName watch.example.com
    ProxyPass / http://localhost:8881/
    ProxyPassReverse / http://localhost:8881/

    # Enable websocket-support
    RewriteEngine on
    RewriteCond %{REQUEST_URI}  ^/socket.io [NC]
    RewriteCond %{QUERY_STRING} transport=websocket [NC]
    RewriteRule /(.*) "ws://localhost:8081/$1" [P,L]
</VirtualHost>
```
Hierbei wird ein https-Betrieb dringend empfohlen.