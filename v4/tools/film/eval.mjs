// node tools/film/eval.mjs "<expression>" [port]: evaluate in the capture Chrome's page, print JSON.
import { connect } from './cdp.mjs';
const cdp = await connect({ port: Number(process.argv[3] ?? 9333) });
try {
  console.log(JSON.stringify(await cdp.evaluate(process.argv[2]), null, 1));
} finally {
  cdp.close();
}
