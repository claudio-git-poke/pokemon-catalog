// Physical card languages/regions. API aliases are not treated as new printings.
export const CATALOG_LANGUAGES = [
 {api:'en',code:'INT',label:'Inglese / internazionale',region:'Internazionale'},
 {api:'it',code:'IT',label:'Italiano',region:'Europa'},
 {api:'fr',code:'FR',label:'Francese',region:'Europa'},
 {api:'de',code:'DE',label:'Tedesco',region:'Europa'},
 {api:'es',code:'ES',label:'Spagnolo europeo',region:'Europa'},
 {api:'pt',code:'PT',label:'Portoghese',region:'Brasile'},
 {api:'ko',code:'KOR',label:'Coreano',region:'Corea'},
 {api:'ja',code:'JP',label:'Giapponese',region:'Giappone'},
 {api:'zh-tw',code:'CHN-T',label:'Cinese tradizionale',region:'Taiwan / Hong Kong'},
 {api:'id',code:'ID',label:'Indonesiano',region:'Indonesia'},
 {api:'th',code:'TH',label:'Thailandese',region:'Thailandia'},
 {api:'zh-cn',code:'CHN',label:'Cinese semplificato',region:'Cina continentale'},
 {api:'nl',code:'NL',label:'Olandese',region:'Europa · storico'},
 {api:'pl',code:'PL',label:'Polacco',region:'Europa · storico'},
 {api:'ru',code:'RU',label:'Russo',region:'Russia · storico'},
 {api:'es-mx',code:'ES-LA',label:'Spagnolo latinoamericano',region:'America Latina'},
] as const
export const CATALOG_LANGUAGE_CODES: readonly string[] = [...CATALOG_LANGUAGES.map(l=>l.code),'EN']
