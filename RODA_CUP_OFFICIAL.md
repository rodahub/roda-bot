# RODA CUP - base ufficiale

Questo repository pubblico diventa la base ufficiale per sito e bot torneo.

## Perché usare questo repo

Questa versione contiene già le parti corrette che mancavano nella vecchia copia privata:

- nome torneo centralizzato;
- limite team centralizzato;
- formato terzetti centralizzato;
- lifecycle torneo;
- match separati;
- stati team per match;
- regole ufficiali integrate;
- punteggio bloccato;
- login admin multiutente;
- ruoli proprietario, admin e staff;
- protezioni HTTP;
- rate limit;
- archivi torneo;
- promemoria automatici.

## Decisione progetto

Da ora la base da usare per deploy e sviluppo è:

`rodahub/roda-bot`

La vecchia copia privata va trattata come backup storico e non come sorgente principale.

## Controlli prima del deploy

Prima di fare deploy verifica:

1. Hosting collegato a questo repository.
2. Branch di deploy: `main`.
3. Storage persistente attivo.
4. Password proprietario iniziale impostata su hosting.
5. Secret sessione impostato su hosting.
6. Token Discord impostato su hosting.
7. ID server e canali Discord impostati su hosting.
8. URL pubblico impostato su hosting.

## Regole fisse RODA CUP

- Nome torneo: RODA CUP.
- Formato: terzetti.
- Massimo 16 team.
- Uso obbligatorio vocali Discord ufficiali.
- Vietati mine, claymore, psicogranate, granate stordenti, lacrimogeni, scarica elettrica e skin Terminator.
- Sistema disciplinare: primo richiamo, secondo sottrazione punti, terzo squalifica.
- Solo armi meta approvate dallo staff.
- Massimo 1 cecchino per team.
- Risultati validati con screenshot e dati completi.
- Decisioni staff definitive.

## Punteggio fisso

- Kill squadra: 1 punto per kill.
- Primo posto: 10 punti bonus.
- Secondo posto: 6 punti bonus.
- Terzo posto: 5 punti bonus.
- Quarto posto: 4 punti bonus.
- Quinto posto: 3 punti bonus.
- Sesto posto: 2 punti bonus.
- Settimo posto: 1 punto bonus.
- Ottavo posto: 1 punto bonus.

## Prossime migliorie codice

- Pulire eventuali ID Discord hardcoded rimasti.
- Separare `public/admin.html` in file CSS e JS dedicati.
- Aggiungere test automatici per storage, match e calcolo punti.
- Aggiungere script di verifica configurazione prima dell'avvio.
