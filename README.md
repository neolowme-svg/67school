# 67school – Walewyc Mavo schoolfeest

Deze versie gebruikt Vercel Private Blob voor permanente inzendingen en back-ups.

Belangrijkste wijzigingen:
- Admin pollt elke 1 seconde zonder de pagina volledig opnieuw te renderen.
- Opengeklapte apparaatdetails blijven open tijdens live updates.
- Reacties kunnen veilig worden verwijderd; vooraf wordt automatisch een back-up gemaakt.
- Back-upcentrum: handmatige back-up, lijst van back-ups, individuele download en alle back-ups als één JSON-bundel.
- De meegeleverde `data/seed-responses.json` bevat de 5 oude inzendingen uit `67school-resultaten.csv` en wordt bij de eerste Vercel-run automatisch aan Blob toegevoegd als die IDs nog niet bestaan.
- Een verwijderde oude seed-reactie blijft verwijderd via een tombstone-record.
- Browser/apparaatinfo blijft zichtbaar in admin voor zover browsers die informatie beschikbaar stellen.

## Deploy

1. Zorg dat het Vercel-project aan een Private Blob store gekoppeld is.
2. Zorg dat `ADMIN_PASSWORD` als Production environment variable bestaat.
3. Push naar GitHub; Vercel deployt automatisch.

## Lokale start

```powershell
npm.cmd install
npm.cmd start
```
