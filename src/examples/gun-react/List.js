import xs from 'xstream';
import {button, div} from '@cycle/react-dom';
import isolate from '@cycle/isolate'
import Item from './Item';
import dropRepeats from 'xstream/extra/dropRepeats';
import sampleCombine from 'xstream/extra/sampleCombine';


function entityIntent(entity) {
  const userAttributeList$ = entity.getAttributeList()
    .startWith({ attributeList: [] })
    .compose(dropRepeats());

  return {userAttributeList$}
}

function intent(domSource, itemRemove$) {
  return xs.merge(
    domSource.select('add-one-btn').events('click')
      .mapTo({type: 'ADD_ITEM', payload: 1}),

    domSource.select('add-many-btn').events('click')
      .mapTo({type: 'ADD_ITEM', payload: 5}),

    itemRemove$.map(id => ({typeKey: 'btnattrdel', payload: id}))
  );
}

function model(entityEvents, action$, itemFn) {
  
  function createRandomItemProps() {
    let hexColor = Math.floor(Math.random() * 16777215).toString(16);
    while (hexColor.length < 6) {
      hexColor = '0' + hexColor;
    }
    hexColor = '#' + hexColor;
    const randomWidth = Math.floor(Math.random() * 800 + 200);
    return {color: hexColor, width: randomWidth};
  }

  let mutableLastId = 0;

  function createNewItem(props, id) {
    // const id = mutableLastId++;
    console.log("Create new item: id", id)
    console.log("Create new item: props", props)
    const sinks = itemFn(props, id);
    return {id, DOM: sinks.DOM.remember(), Remove: sinks.Remove};
  }

  const addItemReducer$ = action$
    .filter(a => a.type === 'ADD_ITEM')
    .map(action => {
      const amount = action.payload;
      let newItems = [];
      for (let i = 0; i < amount; i++) {
        newItems.push(createNewItem(action.attributeList[i], i));
      }
      return function addItemReducer(listItems) {
        return listItems.concat(newItems);
      };
    });

  const removeItemReducer$ = action$
    .filter(a => a.typeKey === 'btnattrdel')
    .map(action => function removeItemReducer(listItems) {
      return listItems.filter(item => item.id !== action.payload);
    });

  const initialState = [createNewItem({color: 'red', width: 300, text: "red"})]

  const stateItemReducer$ = entityEvents.userAttributeList$
  .map(action => {
    const amount = action.attributeList.length;
    let newItems = [];
    console.log("total items: " + amount)
    for (let i = 0; i < amount; i++) {
      newItems.push(createNewItem(action.attributeList[i], i));
    }
    return function stateItemReducer(listItems) {
      console.log("original listitems has " + listItems.length + ". will add " + newItems.length)
      return [].concat(newItems);
    };
  });

  return xs.merge(addItemReducer$, removeItemReducer$, stateItemReducer$)
    .fold((listItems, reducer) => reducer(listItems), []);
}

function view(items$) {
  const addButtons = div('.addButtons', [
    button('add-one-btn', 'Add New Item'),
    button('add-many-btn', 'Add Many Items')
  ]);

  return items$.map(items => {
    const itemVNodeStreamsByKey = items.map(item =>
      item.DOM.map(vnode => {
        console.log("vnode = ", vnode)
        console.log("item.id = ", item.id)
        let vnode1 = { ...vnode , key: item.id};
        console.log("vnode1 = ", vnode1)

        // vnode.key = item.id; 
        return vnode1;
      })
    );
    return xs.combine(...itemVNodeStreamsByKey)
      .map(vnodes => div('.list', [].concat(vnodes)));
  }).flatten();
}

function makeItemWrapper(DOM) {
  return function itemWrapper(props, id) {
    const item = isolate(Item)({DOM, Props: xs.of(props)});
    return {
      DOM: item.DOM,
      Remove: item.Remove.mapTo(id)
    }
  }
}

function entityTodo(clickevents$, state$) {
  // sink map filtered stream of payloads into function and emit function
  const outgoingEntityEvents$ = clickevents$
  .compose(sampleCombine(state$))
    .map( ([click, state]) => {
      // console.log("ENTITY todo state=", state)
      // console.log("ENTITY click=", click)
      // if (state.userinput && state.authenticated) {
        if (click.typeKey === 'btnattrdel') {
          return {action: 'btnattrdel', userinput: state.userinput, stageName: state.stageName, pos: click.pos}
        }
      // } else {
      //   console.log("either no content or not signed in");      
      // }
    });
  return outgoingEntityEvents$
}


function List(sources) {
  const { DOM, entity } = sources;
  const entityEvents = entityIntent(entity);
  const proxyItemRemove$ = xs.create();
  const action$ = intent(sources.DOM, proxyItemRemove$);
  const itemWrapper = makeItemWrapper(sources.DOM);
  const items$ = model(entityEvents, action$, itemWrapper);
  const outgoingEntityEvents$ = entityTodo(events.clickevents$, state$)
  
  const itemRemove$ = items$
    .map(items => xs.merge(...items.map(item => item.Remove)))
    .flatten();
  proxyItemRemove$.imitate(itemRemove$);
  const vtree$ = view(items$);

  return {
    DOM: vtree$,
    entity: outgoingEntityEvents
  };
}

export default List;
