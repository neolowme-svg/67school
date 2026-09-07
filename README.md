# 67school — Walewyc Mavo Schoolfeest

Schoolfeest-vragenlijst voor 67school.site met een professioneel wit ontwerp, subtiele animaties, confetti-intro, lokale JSON-opslag en een live adminpaneel op `/admin`.

## Lokaal starten

```powershell
cd C:\Users\neolo\Documents\dev\67school
npm.cmd install
notepad .env
npm.cmd start
```

Open daarna `http://localhost:3000` en `http://localhost:3000/admin`.

## Omgevingsvariabelen

Kopieer `.env.example` naar `.env` en verander minimaal:

```env
PORT=3000
ADMIN_PASSWORD=zet-hier-een-sterk-wachtwoord
```

## Opslag

Lokaal worden reacties opgeslagen in `data/responses.json`. Het adminpaneel ververst automatisch om de 2,5 seconden, dus nieuwe resultaten verschijnen zonder handmatig refreshen.

### Belangrijk over Vercel

Vercel gebruikt serverless functies en heeft **geen blijvende lokale schijf** voor dit soort JSON-opslag. De site kan op Vercel als preview draaien, maar reacties in de lokale JSON-database kunnen bij een nieuwe serverless instance of deployment verdwijnen. Voor echte blijvende resultaten heb je op Vercel een externe datastore nodig, of je host deze Node-app op een server met persistente schijfruimte.

## GitHub

Voer vanuit de projectmap uit:

```powershell
git init
git add .
git commit -m "Initial 67school website"
git branch -M main
git remote add origin https://github.com/JOUW-GITHUB-NAAM/67school.git
git push -u origin main
```

Maak vóór de laatste twee opdrachten een lege GitHub repository met de naam `67school` en vervang `JOUW-GITHUB-NAAM` door je eigen GitHub-gebruikersnaam.

`.env` staat in `.gitignore` en wordt dus niet naar GitHub gestuurd. Stel `ADMIN_PASSWORD` later als Environment Variable in bij je host.
