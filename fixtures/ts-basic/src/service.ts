import { Repo } from './repo';
import { shout } from './util';

export class Base {
  greet(): string {
    return 'hi';
  }
}

export class UserService extends Base {
  constructor(private repo: Repo) {
    super();
  }

  find(id: string) {
    return this.repo.get(id);
  }

  run() {
    this.greet();
    return shout('x');
  }
}
