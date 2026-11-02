# HIRAGANA — versione installabile

Questa cartella contiene una prima conversione multipiattaforma dell'app HTML originale. L'interfaccia, gli esercizi e i contenuti restano incorporati in `index.html`; manifest e service worker aggiungono installazione e avvio offline dopo la prima visita.

## Analisi tecnica verificata

- **Struttura:** un unico documento HTML (~163 KB), con CSS e JavaScript incorporati; 56 elementi identificati tramite ID.
- **Dipendenze:** nessun framework o libreria JavaScript; il solo asset esterno è il font Zen Maru Gothic da Google Fonts. Se offline, il browser usa i font di fallback.
- **Persistenza:** `localStorage` sotto le chiavi `hira-stats`, `hira-done`, `hira-voice` e `hira-lastexp`. Stato locale per browser/profilo e origine; non sincronizza dispositivi.
- **Backup:** export/import testuale `HIRA1:` già implementato nel prodotto. Tenerlo come copia prima di migrazioni e usarlo per trasferire lo stato di una installazione `file://` all'origine web installata, se necessario.
- **Capacità del dispositivo:** sintesi vocale, riconoscimento vocale, clipboard e resa del font variano con sistema operativo/browser; il riconoscimento vocale potrebbe richiedere rete o non essere disponibile.
- **Indipendenza:** nel file non sono presenti riferimenti a Claude/Anthropic, chiamate API o server applicativi.

## Avvio e installazione

Serve un hosting statico con HTTPS (anche un server statico locale per sviluppo), perché i service worker non funzionano da `file://`.

1. Pubblicare l'intera cartella mantenendo insieme i tre file.
2. Aprire l'indirizzo HTTPS su Mac/iPhone e attendere il primo caricamento.
3. Su iPhone usare Condividi → Aggiungi alla schermata Home. Su Mac installare dal menu del browser compatibile o creare un collegamento app.
4. Dopo il primo caricamento riuscito, l'app-shell è disponibile offline. Gli aggiornamenti si ricevono quando il dispositivo torna online.

I dati salvati nell'origine del vecchio file HTML non sono automaticamente leggibili da un nuovo dominio: i browser isolano lo storage per origine. Prima di abbandonare l'originale, esportare il codice `HIRA1:` e importarlo nella nuova installazione. La conversione mantiene anche la funzione di backup originale.

## Sincronizzazione cloud: stato e architettura

La sincronizzazione automatica **non è ancora attiva**. Nel file originale non esiste alcun backend; attivarla richiede un servizio scelto dall'utente, un'identità/account per separare i progressi e configurazione di sicurezza. Non sono state inserite chiavi, endpoint o credenziali fittizi.

Architettura consigliata una volta scelto il provider:

1. mantenere `localStorage` come copia locale e modalità offline;
2. serializzare i soli progressi (`hira-stats`, `hira-done`) in uno schema versionato, senza includere preferenze vocali salvo richiesta;
3. associare i dati all'utente autenticato, applicare regole di accesso per utente e usare un timestamp/revisione per la risoluzione dei conflitti;
4. sincronizzare in background al ritorno della rete, senza sovrascrivere dati preesistenti al primo collegamento; presentare una scelta di unione se cloud e dispositivo hanno entrambi progressi differenti;
5. mantenere export/import `HIRA1:` come backup indipendente dal provider.

Servizi da valutare:

- **iCloud/CloudKit:** esperienza Apple integrata; meno adatto a un'unica app web che funzioni in modo uniforme su Android e browser desktop.
- **Supabase:** backend gestito con autenticazione e database; richiede progetto, URL e chiave pubblica configurati correttamente, policy per utente e valutazione dei costi/limiti correnti.
- **Firebase:** autenticazione e database gestiti; richiede progetto, configurazione client e regole di accesso per utente, con costi/limiti da verificare.

Per completare il cloud servono: provider preferito, nome/dominio di pubblicazione, scelta se sincronizzare anche le preferenze vocali, e modalità di accesso (account email, Apple/Google o altra scelta supportata dal provider). Le chiavi pubbliche client non sono segreti, ma le regole server e le credenziali privilegiate non vanno mai incorporate nell'HTML.
