import styled from 'styled-components';
import xs from 'xstream';
import dropRepeats from 'xstream/extra/dropRepeats';
import sampleCombine from 'xstream/extra/sampleCombine';
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import Random from 'random-id';
// import { CustomStep, OptionsStep, TextStep } from './steps_components';
// import schema from './schemas/schema';
// import * as storage from './storage';
// import { Entity } from '../../Entity'
import { set } from 'lodash';
import { div, form, ul, li, h1, input, button } from '@cycle/react-dom';

const Footer_old = styled.div`
  position: relative;
`;

function entityIntent(entity) {
  const useris$ = entity.getSignStatus()
    .startWith({ authenticated: false, stageName: 'unknown' });
  return { useris$ }
}

function Intent(DOM) {
  const QAInput$ = DOM
    .select('qainput')
    .events('input')
    .map(ev => {
      // console.log(" message= ", ev.target.value);
      return { userinput: ev.target.value }
    }).startWith({ userinput: "nothing" })
    .remember();
  
  const clickevents$ = DOM
    .select('btnsend')
    .events('click')
    .map(ev => {
      // console.log("Clicked send!")
      return { typeKey: 'btnsend' }
    }).startWith({ typeKey: 'noclick' });

  return { clickevents$, QAInput$ }
}

function model(entityEvents, events) {
  const state$ = xs.merge(entityEvents.useris$, events.QAInput$)
    .fold((acc, x) => { return { ...acc, ...x } }, {})
    .startWith({ authenticated: false, userinput: '' })
  return state$
}

function view(state$) {
  const vdom$ = state$
    .map( state => {
      // console.log("state=", state)
      return div('.mid.col.rowC', [
            input({ sel: 'qainput', type: 'text', placeholder: 'anything', defaultValue: 'default string' }),
            // h1("sp"),
            button({ sel: 'btnsend' }, 'send'),
            // h1('footer' + state.sent)
          ])    
    });
  return vdom$
}

function entityTodo(clickevents$, state$) {
  // sink map filtered stream of payloads into function and emit function
  const outgoingEntityEvents$ = clickevents$
  .compose(sampleCombine(state$))
    .map( ([click, state]) => {
      // console.log("ENTITY todo state=", state)
      // console.log("ENTITY click=", click)
      if (state.userinput && state.authenticated) {
        if (click.typeKey === 'btnsend') {
          return {action: 'btnsend', userinput: state.userinput, stageName: state.stageName}
        }
      } else {
        console.log("either no content or not signed in");      
      }
    });
  return outgoingEntityEvents$
}

function Footer(sources) {
  const { DOM, entity } = sources;
  const entityEvents = entityIntent(entity);
  const events = Intent(DOM);
  const state$ = model(entityEvents, events)
  const outgoingEntityEvents$ = entityTodo(events.clickevents$, state$)
  const vdom$ = view(state$)
  const sinks = {
    DOM: vdom$,
    value: state$,
    entity: outgoingEntityEvents$
  }
  return sinks;
}

export default Footer;
