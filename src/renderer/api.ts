import type { InvokeChannel, InvokeMap } from '@shared/ipc'
import type { AppErrorInfo } from '@shared/types'

/** Error carrying the structured info produced by the main process. */
export class UiError extends Error {
  constructor(readonly info: AppErrorInfo) {
    super(info.message)
  }
}

/** Invoke a main-process API and unwrap the result, throwing UiError on failure. */
export async function call<C extends InvokeChannel>(
  channel: C,
  ...args: InvokeMap[C]['args'] extends void ? [] : [InvokeMap[C]['args']]
): Promise<InvokeMap[C]['result']> {
  const result = await window.framecast.invoke(channel, ...args)
  if (!result.ok) throw new UiError(result.error)
  return result.value
}

export function errorInfoOf(err: unknown): AppErrorInfo {
  if (err instanceof UiError) return err.info
  return { code: 'UNKNOWN', message: err instanceof Error ? err.message : String(err) }
}
