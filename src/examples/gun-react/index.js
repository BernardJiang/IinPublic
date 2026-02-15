import './index.css';
import App from './App';
import * as serviceWorker from './serviceWorker';
import { run } from "@cycle/run";
import { makeDOMDriver } from "@cycle/react-dom";
import {makeHashHistoryDriver} from '@cycle/history';
import { makeEntityDriver } from './Entity';

run(App, {
    react: makeDOMDriver(document.getElementById("root")),
    history: makeHashHistoryDriver(),
    entity: makeEntityDriver({root: 'root', peers: ['http://localhost:8765/gun']})
  });
  


// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: http://bit.ly/CRA-PWA
serviceWorker.unregister();
