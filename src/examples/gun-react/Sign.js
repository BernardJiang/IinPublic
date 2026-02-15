import xs from 'xstream';
import dropRepeats from 'xstream/extra/dropRepeats';
import sampleCombine from 'xstream/extra/sampleCombine';

import React, { Component } from 'react'
import './style.css'
import Entity from './Entity';
import { div, form, ul, li, h1, input, button } from '@cycle/react-dom';

function entityIntent(entity) {
  const userAuth$ = entity.getUserList()
    .startWith({ userlist: ["noone"] })
    .compose(dropRepeats());

  const useris$ = entity.getSignStatus()
    .fold((acc, x) => {
      if(acc.stageName === "") 
        return x;
      if(acc.stageName == x.stageName)
        return x;
      return acc;
    }, { authenticated: false, stageName: "" });

  return { userAuth$, useris$ }
}

function Intent(DOM) {
  const stageNameInput$ = DOM
    .select('stagenameinput')
    .events('input')
    .map(ev => {
      // console.log(" stagename ev value=", ev.target.value);
      return ev.target.value
    }).startWith("");

  const passwordInput$ = DOM
    .select('signpassword')
    .events('input')
    .map(ev => {
      // console.log(" password ev value=", ev.target.value);
      return ev.target.value
    }).startWith("");

  const newValueName$ = stageNameInput$.map(v => {
    // console.log("New stagename = ", v);
    return { stageName: v }
  }).remember();
  const newValuePassword$ = passwordInput$.map(v => { return { password: v } }).remember();

  const clickeventsignin$ = DOM
    .select('btnsignin')
    .events('click')
    .map(ev => {
      return { typeKey: 'signin' }
    }).startWith({ typeKey: 'noclick' });

  const clickeventsignup$ = DOM
    .select('btnsignup')
    .events('click')
    .map(ev => {
      return { typeKey: 'signup' }
    }).startWith({ typeKey: 'noclick' });

  const clickevents$ = xs.merge(clickeventsignin$, clickeventsignup$)

  return { clickevents$, newValueName$, newValuePassword$ }
}

function model(entityEvents, events) {
  const state$ = xs.merge(entityEvents.userAuth$, entityEvents.useris$, events.newValueName$, events.newValuePassword$)
    .fold((acc, x) => { return { ...acc, ...x } }, {})
    .startWith({ userlist: [], authenticated: false, stageName: '', password: '' })
  return state$
}

function view(state$) {
  const vdom$ = state$
    .map(state =>
      div('#divSign.hue.page', [
        form('#inup.sign.pad.center', [
          div('.mid.row.col', [
            h1('Enter your stageName: ' + state.stageName),
            input({ sel: 'stagenameinput', type: 'text', placeholder: state.stageName != undefined ? state.stageName : 'stagename' })
          ]),
          div('.mid.row.col', [
            h1('A long private passphrase: ' + state.password),
            input({ sel: 'signpassword', type: 'password', placeholder: state.password != undefined ? state.password : 'password' })
          ]),
          div('.mid.row.col.go', [
            button({ sel: 'btnsignin' }, state.authenticated ? 'Sign Out' : 'Sign In'),
            div('.or', [h1('or')]),
            button({ sel: 'btnsignup' }, 'sign up'),
            h1('button signin is clicked : ' + state.signin + " and sign up : " + state.signup)
          ]),
          div('.mid.row.col.go', [
            h1('number of users :' + (!!state.userlist && "length" in state.userlist ? state.userlist.length : 0))
          ]),
          // <a href="info">more info</a>
          div('.mid.row.col.go', [
            !!state.userlist && ul(state.userlist.map((item) => li(item)))
          ])
          ])
      ])

    );
  return vdom$
}

function entityTodo(clickevents$, state$) {
  // sink map filtered stream of payloads into function and emit function
  const outgoingEntityEvents$ = clickevents$
    .compose(sampleCombine(state$))
    .map(([click, state]) => {
      if (state.stageName && state.password) {
        if (click.typeKey === 'signin') {
          return {action: 'signin', authenticated: state.authenticated, stageName: state.stageName, password: state.password}
        }

        if (click.typeKey === 'signup') {
          return {action: 'signup', stageName: state.stageName, password: state.password}
        }
      } else {
        // console.log("stagename or password is invalid", state.stageName, state.password);      
      }

    });
  return outgoingEntityEvents$
}

export function SignIn(sources) {
  const { DOM, entity } = sources;
  // console.log('sources.entity', entity)

  const entityEvents = entityIntent(entity);
  const events = Intent(DOM);

  const state$ = model(entityEvents, events)

  const vdom$ = view(state$)
  const outgoingEntityEvents$ = entityTodo(events.clickevents$, state$)

  const sinks = {
    DOM: vdom$,
    value: state$,
    entity: outgoingEntityEvents$
  }
  return sinks;

}
