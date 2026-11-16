import type {Card} from './supabase'

export const MANUAL_CARD_FIELDS = [
 ['nome','Nome'],['sigla','Espansione'],['lingua','Lingua'],['numero','Numero'],['variante','Variante'],
 ['codice','Codice stampato'],['link_cardmarket','Link Cardmarket'],['image_url','Foto'],['image_status','Stato della foto'],
 ['image_source','Fonte della foto'],['notes','Note'],['file_name','Nome file']
] as const
export type ManualCardField = typeof MANUAL_CARD_FIELDS[number][0]
export function selectedManualFields(fields: ManualCardField[]): ManualCardField[] {
 const selected = new Set(fields)
 if (fields.some(f => ['image_url','image_status','image_source'].includes(f))) {
  selected.add('image_url');selected.add('image_status');selected.add('image_source')
 }
 return [...selected].sort()
}
export function protectionExpectedValues(card: Card, fields: ManualCardField[]) {
 return Object.fromEntries(selectedManualFields(fields).map(field => [field,card[field] ?? null]))
}
