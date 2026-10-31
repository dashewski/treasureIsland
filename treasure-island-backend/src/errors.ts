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
