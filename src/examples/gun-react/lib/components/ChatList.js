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
import ChatItem from './ChatItem';


function entityIntent(entity) {
  const chat$ = entity.getChat().map(msg => {
    // console.log("Chatbot got : ", msg)
    return {msglist: msg}
  })

  return {chat$}
}

function Intent(DOM, itemAction$) {
  
  // const clickevents$ = itemAction$.filter(obj => obj.typeKey === 'btnattrdel').map(obj => ({typeKey: 'btnattrdel', payload: obj.id}))
  // const clickAnswers$ = itemAction$.filer(obj => obj.typeKey === 'btnAns').map(obj => ({typeKey: 'btnAns', payload: obj.id, ButtonIndex: obj.ButtonIndex}))
  const clickevents$ = itemAction$

  return { clickevents$ }
}

function model(entityEvents, events, itemFn) {
  function createNewItem(props, id) {
    const sinks = itemFn(props, id);
    return {id, DOM: sinks.DOM.remember(), Action: sinks.Action};
  }

  const stateItemReducer$ = entityEvents.chat$
  .map(action => {
    const amount = action.msglist.length;
    let newItems = [];
    // console.log("total items: " + amount)
    // console.log(action.attributeList)
    for (let i = 0; i < amount; i++) {
      newItems.push(createNewItem(action.msglist[i], i));
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

    }).flatten();
  return vdom$
}

function makeItemWrapper(DOM) {
  return function itemWrapper(props, id) {
    const item = isolate(ChatItem)({DOM, Props: xs.of(props)});
    return {
      DOM: item.DOM,
      Action: item.Action.map( obj => {
        obj.id= id
        return obj
      })
    }
  }
}

function entityTodo(clickevents$, state$) {
  // sink map filtered stream of payloads into function and emit function
  const outgoingEntityEvents$ = clickevents$
  .compose(sampleCombine(state$))
    .map( ([click, state]) => {
      // console.log("ENTITY todo state=", state)
      console.log("ENTITY click=", click)
      // if (state.userinput && state.authenticated) {
        if (click.typeKey === 'btnattrdel') {
          return {action: 'btnattrdel', userinput: state.userinput, stageName: state.stageName, pos: click.id}
        } else if (click.typeKey === 'btnAns' ) {
          console.log(click)
          return {action: 'btnAns', id: click.id, ButtonIndex: click.ButtonIndex, stageName: state.stageName, ...click}
        }
      // } else {
      //   console.log("either no content or not signed in");      
      // }
    });
  return outgoingEntityEvents$
}

function ChatList(sources) {
  const { DOM, entity } = sources;
  const entityEvents = entityIntent(entity);
  const proxyItemAction$ = xs.create();
  const events = Intent(DOM, proxyItemAction$);
  const itemWrapper = makeItemWrapper(sources.DOM);
  const state$ = model(entityEvents, events, itemWrapper);
  const outgoingEntityEvents$ = entityTodo(events.clickevents$, state$)
  const itemAction$ = state$
    .map(items => xs.merge(...items.map(item => item.Action)))
    .flatten();
  proxyItemAction$.imitate(itemAction$);
  const vdom$ = view(state$)
  const sinks = {
    DOM: vdom$,
    value: state$,
    entity: outgoingEntityEvents$
  }
  return sinks;
}

export default ChatList;


