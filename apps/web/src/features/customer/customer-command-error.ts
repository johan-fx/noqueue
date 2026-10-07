export class CustomerCommandError extends Error {
  readonly requiresReview: boolean
  constructor(message: string, requiresReview: boolean) {
    super(message)
    this.requiresReview = requiresReview
  }
}
