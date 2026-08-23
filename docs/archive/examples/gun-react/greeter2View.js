import React, { Component }  from 'react'
import './style.css'
import Entity from './Entity';
import { div, form, ul, h1, input, button } from '@cycle/react-dom';
import xs from 'xstream';

export function greeter2View(name) {
    return div([
      h1(name ? 'Welcominggg e, ' + name : 'What\'s your ffk name?'),
      input({ sel: 'greeter2namewwww', type: 'text' })
    ])
  }

export function greeterComponent(sources) {

  const initialValue$ = sources.props$.take(1);

  const input$ = sources.DOM
      .select('greeterComponent')
      .events('input')
      .map(ev => { 
        console.log(" greeter input ev value=", ev.target.value);
        return ev.target.value
      });

  const newValue$ = input$.map( v => { return { value: v, label: 'lbl: ' + v} }); 
      
  const state$ = xs.merge(initialValue$, newValue$).remember();

    const vdom$ = state$
       .map( state => 
           div('#divGreeter', [
            h1('Welcome, ' + state.label ),
            input({ sel: 'greeterComponent', type: 'text' })
          ])
        );
    const sinks = {
        DOM: vdom$,
        value: state$.map(state => state.value)
    }
    return sinks;
  }
  