# 67school — Walewyc Mavo schoolfeest

Versie 2 gebruikt op Vercel **Private Blob** als permanente opslag. Elke inzending wordt als een eigen JSON-object opgeslagen, zodat gelijktijdige inzendingen elkaar niet kunnen overschrijven en een refresh geen antwoorden kan wissen.

Daarnaast maakt de app **na iedere inzending** een volledige JSON-snapshot in `backups/`. Dat is voor een schoolvragenlijst veiliger dan alleen wachten op een timer: zodra een antwoord succesvol is opgeslagen, bestaat het zowel als individueel record als in een snapshot.

## Waarom geen `*/15` Vercel Cron in vercel.json?

Vercel Hobby staat momenteel alleen dagelijkse native Cron-runs toe. Een 15-minutencron kan een Hobby deployment blokkeren. Daarom bevat deze versie bewust geen verplichte 15-minutencron. Op Pro kan `/api/cron/backup` desgewenst met `*/15 * * * *` worden gepland. Zonder extra dienst blijft de gratis/Hobby-versie toch duurzaam doordat elk antwoord direct permanent wordt opgeslagen en direct een snapshot triggert.

## Admin

`/admin` bevat live resultaten, zoeken/filteren, technische browser-/apparaatinfo, opslagstatus, back-upstatus, CSV/JSON export en CSV/JSON import.

De browser kan geen echte Windows/telefoon-apparaatnaam uitlezen. Er wordt alleen browser-beschikbare technische info verzameld; dit wordt zichtbaar vermeld op het formulier.

## Vercel

1. Koppel een **Private Blob store** aan hetzelfde Vercel-project.
2. Zet `ADMIN_PASSWORD` voor Production.
3. Deploy opnieuw.

Lokaal gebruikt `npm start` nog `data/responses.json`.
