/** Words and counts every part of the interface uses. Owned by the i18n core: areas read, don't add. */
export const common = {
  cancel: 'Cancel',
  close: 'Close',
  continue: 'Continue',
  done: 'Done',
  pages: (n: number) => (n === 1 ? '1 page' : `${n} pages`),
  items: (n: number) => (n === 1 ? '1 item' : `${n} items`),
  fields: (n: number) => (n === 1 ? '1 field' : `${n} fields`),
  documents: (n: number) => (n === 1 ? '1 document' : `${n} documents`),
}

export type CommonMessages = typeof common
