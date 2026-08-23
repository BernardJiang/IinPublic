import xs from 'xstream';
import sampleCombine from 'xstream/extra/sampleCombine';
import { div, form, ul, li, h1, input, button, p } from '@cycle/react-dom';

function intent(domSource) {
  const butdelete$ = domSource.select('btnattrdel').events('click').mapTo({typeKey: 'btnattrdel'})
  const but0$ = domSource.select('btnopt0').events('click').map(ev => {
    console.log(ev)
    return ev
  }).mapTo({typeKey: 'btnAns', ButtonIndex: 0})
  const but1$ = domSource.select('btnopt1').events('click').mapTo({typeKey: 'btnAns', ButtonIndex: 1})
  const but2$ = domSource.select('btnopt2').events('click').mapTo({typeKey: 'btnAns', ButtonIndex: 2})
  const but3$ = domSource.select('btnopt3').events('click').mapTo({typeKey: 'btnAns', ButtonIndex: 3})
  const but4$ = domSource.select('btnopt4').events('click').mapTo({typeKey: 'btnAns', ButtonIndex: 4})
  const but5$ = domSource.select('btnopt5').events('click').mapTo({typeKey: 'btnAns', ButtonIndex: 5})

  return xs.merge(butdelete$, but0$, but1$, but2$, but3$, but4$, but5$);

}

function model(props$, action$) {
  const usePropsReducer$ = props$
    .map(props => function usePropsReducer(oldState) {
      return props;
    });

    const Answer$ = action$
    .filter(a => a.typeKey === 'btnAns')
    .compose(sampleCombine(props$))
    .map(([action, props]) => {    
      console.log(props)
      return {...action, ...props};
    });
    
    // .map(action => function AnswerReducer(oldState)

  const domState$ = xs.merge(usePropsReducer$)
    .fold((state, reducer) => reducer(state), {color: '#888', width: 200});
  // const gunState$ = xs.merge(AnswerReducer$)
  // .fold((state, reducer) => reducer(state), {color: '#888', width: 200});
  return {domState: domState$,  gunState: Answer$}
}

function view(state$) {
  return state$.map((props) => {
    // console.log("in item view: ", props)
    const oparr = []
    if (props.oplen != 0 ){
      var i;
      for (i=0; i<props.oplen; i++){
        oparr.push( button('btnopt'+i, props['op'+i] ))
      }
      // oparr.push( p( props['op'+i] + '. '))
    }

    let color = '#888'
    let width = 600
    const style = {
      border: '1px solid #000',
      background: 'none repeat scroll 0% 0% ' + color,
      width: width + 'px',
      height: '210px',
      display: 'block',
      padding: '20px',
      margin: '10px 0px'
    };
    return div('.item', {style}, [
      
        div('.bd.rowC', {key: props._}, [
          div('.mr.column', [
            button('btnattrdel', 'x'),
            p(props.stageName == undefined ? "unknown" : (props.stageName)),
            p(props.bot ? "bot" : "human"),
            p(props.isMyself ? "self" : "other"),
          ]),
          div(".bd.column", [
            p(props.question + '?'),
            ...oparr,
            p(props.answer + '.'),
            p( new Date(props.when).toLocaleString().toLowerCase()),
          ]),
        ]),
      
    ]);
  });
}


function ChatItem(sources) {
  const action$ = intent(sources.DOM);
  const state = model(sources.Props, action$);
  const vtree$ = view(state.domState);

  return {
    DOM: vtree$,
    Action: state.gunState, //action$,
    props: state.gunState
  };
}

export default ChatItem;
