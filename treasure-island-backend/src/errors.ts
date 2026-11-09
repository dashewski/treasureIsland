export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class InsufficientBalanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientBalanceError"
  }
}

export class AlreadyInGameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlreadyInGameError"
  }
}

// HTTP 404: the match does not exist
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

// HTTP 403: the player is not in this match
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

// HTTP 409: the request does not fit the state of the match (not your turn, phase is over, ...)
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}
