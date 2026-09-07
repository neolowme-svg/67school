# 67school – maintenance versie

Deze versie voegt toe:
- Onderhoudsmodus in `/admin`.
- Automatische veilige onderhoudsmodus wanneer Vercel Blob niet bereikbaar is.
- Publieke onderhoudspagina met duidelijke tekst voor klas 1 en 2.
- Nieuwe inzendingen worden tijdens onderhoud server-side geblokkeerd.
- Oude site-eigen cookies, localStorage en sessionStorage worden bij een publiek bezoek gewist.
- De oude browser-ID wordt niet meer aangemaakt.

## Belangrijk
De onderhoudsstatus wordt op Vercel in dezelfde Private Blob store bewaard (`system/maintenance.json`). Als de Blob store door een limiet niet bereikbaar is, zet de site zichzelf automatisch in onderhoud. Onderhoud kan dan niet worden uitgezet totdat de opslag weer veilig bereikbaar is.

Een website kan cookies van andere websites niet wissen en kan cookies van bezoekers pas wissen wanneer zij 67school.site opnieuw bezoeken.
