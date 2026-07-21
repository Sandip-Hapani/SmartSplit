/**
 * Every icon the app uses, in one place.
 *
 * Colour follows the *action*, not decoration: creating things reads green
 * (the product's own accent), destructive things read red, edits amber, and
 * anything neutral stays in muted ink. Keeping the map here is what stops the
 * palette drifting as screens get added.
 */
import {
  faArrowLeft, faChartLine, faCircleUser, faDownload, faFilePen, faGear,
  faMagnifyingGlass,
  faMoneyBillTransfer, faNoteSticky, faPaperPlane, faPenToSquare,
  faPersonCirclePlus, faQrcode, faReceipt, faRepeat, faRotateLeft, faTag,
  faTrash, faTrashCan, faUserMinus, faUserPlus, faUsers, faUsersRays,
} from '@fortawesome/free-solid-svg-icons'

export const TAB_ICONS = {
  groups: faUsers,
  friends: faPersonCirclePlus,
  activity: faChartLine,
  account: faCircleUser,
}

// tone -> CSS class defined in styles.css
export const ACTIVITY_ICONS = {
  expense_added:   { icon: faReceipt,           tone: 'add' },
  expense_edited:  { icon: faPenToSquare,       tone: 'edit' },
  expense_deleted: { icon: faTrash,             tone: 'danger' },
  member_added:    { icon: faUserPlus,          tone: 'add' },
  member_removed:  { icon: faUserMinus,         tone: 'danger' },
  group_created:   { icon: faUsersRays,         tone: 'add' },
  group_renamed:   { icon: faTag,               tone: 'edit' },
  group_settings:  { icon: faGear,              tone: 'neutral' },
  settlement:      { icon: faMoneyBillTransfer, tone: 'money' },
  recurring_added: { icon: faRepeat,            tone: 'neutral' },
  undo:            { icon: faRotateLeft,        tone: 'neutral' },
}

export const FALLBACK_ACTIVITY = { icon: faNoteSticky, tone: 'neutral' }

/**
 * An entry keeps its own icon even once it has been undone — it still
 * describes what happened at the time, and the strike-through plus "undone"
 * pill carry the reversal. Only the reversing entry itself gets the undo icon.
 */
export function activityIcon(row) {
  return ACTIVITY_ICONS[row.type] || FALLBACK_ACTIVITY
}

export const UI = {
  back: faArrowLeft,
  editEntry: faFilePen,
  deleteEntry: faTrashCan,
  bill: faReceipt,
  download: faDownload,
  send: faPaperPlane,
  note: faNoteSticky,
  qr: faQrcode,
  search: faMagnifyingGlass,
  addFriend: faPersonCirclePlus,
  settle: faMoneyBillTransfer,
}
