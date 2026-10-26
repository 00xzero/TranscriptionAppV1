/**
 * Sign-in entry point: sends the visitor to the WorkOS hosted sign-in page.
 *
 * Also the WorkOS "Initiate login URI" and where sign-out lands. Signed-in
 * visitors never reach it: proxy.ts redirects them to the Library.
 */
import { getSignInUrl } from '@workos-inc/authkit-nextjs'
import { redirect } from 'next/navigation'

export async function GET() {
  redirect(await getSignInUrl())
}
