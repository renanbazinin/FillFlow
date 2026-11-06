/**
 * Strings for form filling: the form panel (progress, filter, fields, what it shows without fields),
 * the fields on the pages, and the names given to what the PDF leaves unnamed.
 */
export const forms = {
  /** The top of the form panel (ProgressHeader): how far the form is, the field filter, its actions. */
  progress: {
    /**
     * Over the progress bar: "3 of 10 filled". {filled} and {total} are the counts, set in tabular
     * figures; the argument is the filled count, for a language whose words agree with it.
     */
    filled: (_filled: number) => '{filled} of {total} filled',
    /** Required fields still empty (after a red *): "2 required left". {count} is the argument, in tabular figures. */
    requiredLeft: (_count: number) => '{count} required left',
    /** Every required field has a value. */
    requiredDone: 'Required done',
    /** The progress bar's accessible name, and its value as screen readers read it. */
    bar: 'Form progress',
    barValue: (filled: number, total: number) => `${filled} of ${total} fields filled`,
    /** The field filter's accessible name and options (Required and Empty are followed by a count). */
    filter: 'Show fields',
    all: 'All',
    required: 'Required',
    empty: 'Empty',
    /** The reset button's name and tooltip. */
    reset: 'Reset form',
    /** Moves to the next field without a value; once every field has one, it says so instead. */
    next: 'Next empty field',
    allFilled: 'All fields filled',
  },
  /** Resetting every field to the value it had in the PDF (the panel's reset button). */
  reset: {
    title: 'Reset the form?',
    body: 'Every field goes back to the value it had when you opened the PDF. Items you placed on the pages stay.',
    confirm: 'Reset form',
    /** The message once it is done, and its button that takes it back. */
    done: 'Form reset',
    undo: 'Undo',
  },
  /** The fields in the panel (FormPanel, panel/FieldInput). */
  panel: {
    /** A page's fields, in a form of several pages: their heading and accessible name. */
    page: (n: number) => `Page ${n}`,
    /** Read out after a read-only field's label. */
    readOnly: '(read-only)',
    /** A drop-down's empty choice. */
    select: 'Select…',
    /** The placeholder of a drop-down that also takes typed text. */
    chooseOrType: 'Choose or type…',
    /** Beside a list that takes several choices. */
    pickAny: 'Pick any',
    /** A signature field: whether it is signed, and its button. */
    signed: 'Signed',
    notSigned: 'Not signed yet',
    sign: 'Sign',
    signAgain: 'Sign again',
  },
  /** What the panel shows in place of fields (panel/PanelStates). */
  states: {
    noFieldsTitle: 'No fillable fields',
    noFieldsBody: 'This PDF has no built-in form fields — you can still fill it. Pick a tool and click anywhere on a page.',
    /** A dynamic XFA form: it has no fields a browser can fill. */
    xfaTitle: 'Dynamic XFA form',
    xfaBody:
      'This PDF is an Adobe dynamic (XFA) form, which can’t be filled in a browser. You can still type, check and sign on top of the pages, or open it in Adobe Acrobat Reader to use its own fields.',
    /** The Required filter, with every required field filled. */
    requiredDoneTitle: 'Required fields done',
    requiredDoneBody: 'Every required field has a value.',
    /** The Empty filter, with every field filled. */
    allDoneTitle: 'Nothing left to fill',
    allDoneBody: 'Every field has a value. Review the form, then export.',
    /** The Required filter, on a form that marks no field as required. */
    noRequiredTitle: 'No required fields',
    noRequiredBody: 'This form doesn’t mark any field as required.',
  },
  /** The fields on the pages (onpage/*): what screen readers hear on them, and the signature field's words. */
  onPage: {
    /** A radio button: its field's label, then its own. */
    option: (field: string, option: string) => `${field}: ${option}`,
    /** Written in a signature field that isn't signed yet. */
    signHere: 'Sign here',
    /** A signature field, by its label: not signed yet, then signed. */
    unsigned: (field: string) => `${field}: sign here`,
    signed: (field: string) => `${field}: signed — sign again`,
  },
  /** Names for what the PDF leaves unnamed (fields and choices otherwise go by the PDF's own words). */
  names: {
    /** A field whose name has nothing to show. */
    untitled: 'Untitled field',
    /**
     * A field the PDF gives no name; `id` is its object in the file ("12R"). Then made readable like
     * any field name: "(unnamed 12 R)".
     */
    unnamed: (id: string) => `(unnamed ${id})`,
    /** A choice whose value is empty. */
    blank: '(blank)',
  },
}

export type FormsMessages = typeof forms
