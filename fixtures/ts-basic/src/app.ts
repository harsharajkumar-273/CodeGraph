import { UserService } from './service';
import { Repo } from './repo';
import * as m from './math';
import { add } from './util';

const svc = new UserService(new Repo());

export function main() {
  svc.run();
  svc.find('1');
  add(1, 2);
  return m.square(3);
}
