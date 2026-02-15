import xs from 'xstream';
import {button, div, input, p} from '@cycle/react-dom';

function intent(domSource) {
  return xs.merge(
    domSource.select('btnattrdel').events('click')
      .map(ev => {
        console.log("Remove clicked!");
        return ev;
      })
      .mapTo({typeKey: 'btnattrdel'})
  );
}

function model(props$, action$) {
  const usePropsReducer$ = props$
    .map(props => function usePropsReducer(oldState) {
      return props;
    });

  const changeWidthReducer$ = action$
    .filter(a => a.type === 'CHANGE_WIDTH')
    .map(action => function changeWidthReducer(oldState) {
      return {color: oldState.color, width: action.payload};
    });

  const changeColorReducer$ = action$
    .filter(a => a.type === 'CHANGE_COLOR')
    .map(action => function changeColorReducer(oldState) {
      return {color: action.payload, width: oldState.width};
    });

  return xs.merge(usePropsReducer$, changeWidthReducer$, changeColorReducer$)
    .fold((state, reducer) => reducer(state), {color: '#888', width: 200});
}

function view(state$) {
  return state$.map((props) => {
    console.log("in item view: ", props)
    const oparr = []
    if (props.oplen != 0 ){
      var i;
      for (i=0; i<props.oplen; i++){
        oparr.push( p( props['op'+i] + ';'))
      }
    }

    let color = '#888'
    let width = 600
    const style = {
      border: '1px solid #000',
      background: 'none repeat scroll 0% 0% ' + color,
      width: width + 'px',
      height: '110px',
      display: 'block',
      padding: '20px',
      margin: '10px 0px'
    };
    return div('.item', {style}, [
      div('.slider-container', [
        div('.bd.rowC', {key: props._}, [
          p( new Date(props.when).toLocaleString().toLowerCase()),
          p(" :: " + props.message + '?'),
          ...oparr,
          p(props.answer + '.'),
          div('.mr', [
            button('btnattrdel', 'x')
          ])
        ])
      ]),
    ]);
  });
}

function Item(sources) {
  const action$ = intent(sources.DOM);
  const state$ = model(sources.Props, action$);
  const vtree$ = view(state$);

  return {
    DOM: vtree$,
    Remove: action$.filter(action => action.typeKey === 'btnattrdel'),
  };
}

export default Item;
