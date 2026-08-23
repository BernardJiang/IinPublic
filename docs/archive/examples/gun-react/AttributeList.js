import styled from 'styled-components';
import xs from 'xstream';
import isolate from '@cycle/isolate'
import dropRepeats from 'xstream/extra/dropRepeats';
import sampleCombine from 'xstream/extra/sampleCombine';
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import Random from 'random-id';
import { set } from 'lodash';
import { div, form, ul, li, h1, input, button, p } from '@cycle/react-dom';
import AttributeItem from './AttributeItem';


function entityIntent(entity) {
  const userAttributeList$ = entity.getAttributeList()
    .startWith({ attributeList: [] })
    .compose(dropRepeats());

  return {userAttributeList$}
}

function Intent(DOM, itemRemove$) {
  
  const clickevents$ = itemRemove$.map(id => ({typeKey: 'btnattrdel', payload: id}))

  return { clickevents$ }
}

function model(entityEvents, events, itemFn) {
  function createNewItem(props, id) {
    const sinks = itemFn(props, id);
    return {id, DOM: sinks.DOM.remember(), Remove: sinks.Remove};
  }

  const stateItemReducer$ = entityEvents.userAttributeList$
  .map(action => {
    const amount = action.attributeList.length;
    let newItems = [];
    // console.log("total items: " + amount)
    // console.log(action.attributeList)
    for (let i = 0; i < amount; i++) {
      newItems.push(createNewItem(action.attributeList[i], i));
    }
    return function stateItemReducer(listItems) {
      // console.log("original listitems has " + listItems.length + ". will add " + newItems.length)
      return [].concat(newItems);
    };
  });

  const state$ = xs.merge(stateItemReducer$)
    .fold((listItems, reducer) => reducer(listItems), []);

  return state$
}

function view(state$) {
  const vdom$ = state$
    .map( state => {
      // console.log("state=", state)
      const itemVNodeStreamsByKey = state.map(item =>
        item.DOM.map(vnode => {
          // console.log("vnode = ", vnode)
          // console.log("item.id = ", item.id)
          let vnode1 = { ...vnode , key: item.id};
          // console.log("vnode1 = ", vnode1)
          // vnode.key = item.id; 
          return vnode1;
        })
      );
      return xs.combine(...itemVNodeStreamsByKey)
      .map(vnodes => div('.list', [].concat(vnodes)));

    //   return div('.mid.row.col.go', [
    //     !!state.attributeList && Object.values(state.attributeList).sort((a, b) => (a.when < b.when) ? 1 : -1).map((item, id) => {
    //       const oparr = []
    //       if (item.oplen != 0 ){
    //         var i;
    //         for (i=0; i<item.oplen; i++){
    //           oparr.push( p( item['op'+i] + ';'))
    //         }
    //       }
    //       return div('.bd.rowC', {key: id}, [
    //         p( new Date(item.when).toLocaleString().toLowerCase()),
    //         p(item.message + '?'),
    //         ...oparr,
    //         p(item.answer + '.'),
    //         div('.mr', [
    //           button({ sel: 'btnattrdel' }, 'x')
    //         ])
    //       ])
    //     })
    //   ])   
    }).flatten();
  return vdom$
}

function makeItemWrapper(DOM) {
  return function itemWrapper(props, id) {
    const item = isolate(AttributeItem)({DOM, Props: xs.of(props)});
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
          return {action: 'btnattrdel', userinput: state.userinput, stageName: state.stageName, pos: click.payload}
        }
      // } else {
      //   console.log("either no content or not signed in");      
      // }
    });
  return outgoingEntityEvents$
}

function AttributeList(sources) {
  const { DOM, entity } = sources;
  const entityEvents = entityIntent(entity);
  const proxyItemRemove$ = xs.create();
  const events = Intent(DOM, proxyItemRemove$);
  const itemWrapper = makeItemWrapper(sources.DOM);
  const state$ = model(entityEvents, events, itemWrapper);
  const outgoingEntityEvents$ = entityTodo(events.clickevents$, state$)
  const itemRemove$ = state$
    .map(items => xs.merge(...items.map(item => item.Remove)))
    .flatten();
  proxyItemRemove$.imitate(itemRemove$);
 const vdom$ = view(state$)
  const sinks = {
    DOM: vdom$,
    value: state$,
    entity: outgoingEntityEvents$
  }
  return sinks;
}

export default AttributeList;


