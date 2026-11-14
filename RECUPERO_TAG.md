# Tag delle carte già importate

Il workflow **Recupero tag carte esistenti** esamina anche le carte TCGdex importate prima dell'introduzione dei tag. Parte alla pubblicazione della modifica, poi ogni ora, e lavora per un massimo di 40 minuti per sessione. È avviabile anche manualmente. Si ferma quando non ci sono carte esaminabili; gli errori vengono rinviati di sei ore.

La selezione usa `traits_checked_at IS NULL` e gli identificativi espliciti TCGdex: la data di importazione e la presenza dell'immagine non escludono una carta. L'arricchimento ordinario dà la stessa priorità alle carte mai esaminate, prima dei ricontrolli periodici. Le fonti Atlas e le righe prive di identificativo compatibile non vengono inviate all'API TCGdex.

I tag vengono scritti nelle singole stampe di `catalog_search_entries`, usando le stesse mappature del catalogo corrente. Non si applicano tutte le finiture di un Pokémon a tutte le sue carte. Una chiave legacy `normale` non dimostra una finitura non olografica. I dettagli assenti dalla fonte rimangono sconosciuti.

La pubblicazione nelle tabelle Bindex avviene mediante la coda e le verifiche d'identità già esistenti del workflow principale. Il recupero non modifica numeri, identità, codici o immagini e non aggira gli abbinamenti sospesi.

Nella pagina Automazione ogni esecuzione registra: carte controllate, stampe indicizzate, carte TCGdex ancora da esaminare ed errori. “Restanti” include anche gli errori temporaneamente rinviati; non include carte di fonti non supportate. Completare il controllo non garantisce che la fonte abbia documentato ogni variante fisica.
