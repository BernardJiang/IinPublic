import xs from 'xstream';
import { div, form, ul, li, h1, input, button, p } from '@cycle/react-dom';

function intent(domSource) {
  return domSource.select('btnattrdel').events('click')
  .mapTo({typeKey: 'btnattrdel'})
}

function model(props$, action$) {
  const usePropsReducer$ = props$
    .map(props => function usePropsReducer(oldState) {
      return props;
    });


  return xs.merge(usePropsReducer$)
    .fold((state, reducer) => reducer(state), {color: '#888', width: 200});
}

function view(state$) {
  return state$.map((props) => {
    // console.log("in item view: ", props)
    const oparr = []
    if (props.oplen != 0 ){
      var i;
      for (i=0; i<props.oplen; i++){
        oparr.push( p( props['op'+i] + ';'))
      }
      // oparr.push( p( props['op'+i] + '. '))
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
          div('.mr', [
            button('btnattrdel', 'x')
          ]),
          p( new Date(props.when).toLocaleString().toLowerCase()),
          p(" :: " + props.question + '?'),
          ...oparr,
          p(props.answer + '.'),
        ]),
      ]),
    ]);
  });
}


function AttributeItem(sources) {
  const action$ = intent(sources.DOM);
  const state$ = model(sources.Props, action$);
  const vtree$ = view(state$);

  return {
    DOM: vtree$,
    Remove: action$.filter(action => action.typeKey === 'btnattrdel'),
  };
}

export default AttributeItem;
