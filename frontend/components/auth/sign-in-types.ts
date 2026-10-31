import type { Challenge } from '@/contracts/auth'

export type Mode = 'sign-in' | 'sign-up'

export interface PendingCode {
  attempt: string
  challenge: Challenge
  email: string
}

/**
 * Where a message shows, so nothing the person is about to use moves:
 * `top` for one a step opens with (it is there from the first frame),
 * `field` under the field it is about, `action` under the button for any
 * other answer to a submit.
 */
export type Placement = 'top' | 'field' | 'action'
export type Message = { tone: 'error' | 'notice'; text: string; at: Placement; switchToSignIn?: boolean }
