import {
  arrivedEntry,
  backToListAction,
  closeAction,
  entryState,
  openedEntry,
  personEntry,
  readEntry,
  readScreen,
  readView,
  screenSearch,
} from '@/core/projects/people-dialog-history'

const PERSON = '11111111-1111-4111-8111-111111111111'
const isPersonId = (value: string) => value === PERSON

describe('the address', () => {
  test('says whether the dialog is closed, on the list, or on a person', () => {
    expect(readScreen(new URLSearchParams(''), isPersonId)).toEqual({ kind: 'closed' })
    expect(readScreen(new URLSearchParams('people'), isPersonId)).toEqual({ kind: 'list' })
    expect(readScreen(new URLSearchParams(`people=${PERSON}`), isPersonId)).toEqual({ kind: 'person', personId: PERSON })
  })

  test('a person id that is not one opens the list', () => {
    expect(readScreen(new URLSearchParams('people=javascript:alert(1)'), isPersonId)).toEqual({ kind: 'list' })
  })

  test('is written back with a bare people for the list, keeping other parameters', () => {
    const current = new URLSearchParams('from=abc&people=old')
    expect(screenSearch(current, { kind: 'list' })).toBe('?from=abc&people')
    expect(screenSearch(current, { kind: 'person', personId: PERSON })).toBe(`?from=abc&people=${PERSON}`)
    expect(screenSearch(current, { kind: 'closed' })).toBe('?from=abc')
    expect(screenSearch(new URLSearchParams('people'), { kind: 'closed' })).toBe('')
  })
})

describe('history entries', () => {
  test('carry only our own data, never the router fields', () => {
    expect(Object.keys(entryState(openedEntry('a')))).toEqual(['projectPeople'])
  })

  test('are read back only when well formed', () => {
    expect(readEntry(entryState(openedEntry('a')))).toEqual(openedEntry('a'))
    expect(readEntry({ __NA: true })).toBeNull()
    expect(readEntry(null)).toBeNull()
    expect(readEntry({ projectPeople: { entry: 'a', pushed: true, depth: -1, rooted: true } })).toBeNull()
  })

  test('opening from the page is one step from closed; a person is one more', () => {
    const list = openedEntry('a')
    const person = personEntry(list, 'b')
    expect(person).toEqual({ entry: 'b', pushed: true, depth: 2, rooted: true })
  })

  test('arriving by address has nothing of ours behind it', () => {
    const arrived = arrivedEntry('a')
    expect(personEntry(arrived, 'b')).toEqual({ entry: 'b', pushed: true, depth: 1, rooted: false })
  })
})

describe('what the dialog steps do', () => {
  test('← goes back to the list entry when the person was pushed from it, otherwise replaces', () => {
    expect(backToListAction(personEntry(openedEntry('a'), 'b'))).toBe('history-back')
    expect(backToListAction(arrivedEntry('a'))).toBe('replace')
    expect(backToListAction(null)).toBe('replace')
  })

  test('closing goes back past every dialog entry when they began on the closed page', () => {
    expect(closeAction(openedEntry('a'))).toEqual({ kind: 'go', delta: -1 })
    expect(closeAction(personEntry(openedEntry('a'), 'b'))).toEqual({ kind: 'go', delta: -2 })
  })

  test('closing an entry reached by address replaces it, since leaving would leave the page', () => {
    expect(closeAction(arrivedEntry('a'))).toEqual({ kind: 'replace' })
    expect(closeAction(personEntry(arrivedEntry('a'), 'b'))).toEqual({ kind: 'replace' })
    expect(closeAction(null)).toEqual({ kind: 'replace' })
  })
})

describe('saved views', () => {
  test('are read back defensively', () => {
    expect(readView({ query: 'ada', voicesOpen: true, listScroll: 120, personScroll: 40 }))
      .toEqual({ query: 'ada', voicesOpen: true, listScroll: 120, personScroll: 40 })
    expect(readView({ query: 'ada', voicesOpen: true, listScroll: -5, personScroll: 'x' }))
      .toEqual({ query: 'ada', voicesOpen: true, listScroll: 0, personScroll: 0 })
    expect(readView({ voicesOpen: true })).toBeNull()
    expect(readView('nonsense')).toBeNull()
  })
})
