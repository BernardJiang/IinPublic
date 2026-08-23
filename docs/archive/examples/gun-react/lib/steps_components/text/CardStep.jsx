const Photo = {
    width: '60px',
    height: '60px',
    backgroundSize: 'cover',
    borderRadius: '50%',
    margin: '10px'
  };
  
  const bold = {
    fontWeight: 'bold',
  }
  
  const flex = {
    display: 'flex'
  }
  
  const list = {
    listStyleType: 'none',
  }
  
  const ADbox = {
    height: '315px',
    width: '550px',
    borderRadius: '10px 10px 10px 10px',
    border: '1px solid #e5e5e5',
    marginTop: '10px'
  }
  
  const boximg = {
    width: '400px',
  }
  
  const icon = {
    height: '20px',
    paddingLeft: '10px'
  }
  
  const picbox = {
    backgroundSize: 'cover',
    backgroundPosition: 'center 35%',
    width: '550px',
    height: '200px',
    borderRadius: '10px 10px 0px 0px',
  }
  
  const wordbox = {
    padding: '15px',
    fontSize: '14px',
    lineHeight: '21px',
  }
  
  const gray = {
    color: '#aaa'
  }
  
  const iconword = {
    fontSize: '10px',
    paddingLeft: '10px',
    paddingRight: '50px',
    position: 'realative',
  }
  
  const red = {
    color: 'red',
    fontWeight: 'bold'
  }
  
  const iconbox = {
    marginTop: '15px'
  }
  
  const largebox = {
    fontSize: '14px',
    lineHeight: '21px',
    border: '1px solid #eee',
    borderRadius: '5px',
    backgroundColor: 'white',
    boxShadow: '3px 5px 10px #9b7c6c',
    width: '650px',
    margin: '20px auto',
    padding: '15px',
    justifyContent: 'center'
  }
  
  const blue = {
    color: '#7ABBE7'
  }
  
  const listspace = {
    marginLeft: '10px'
  }
  
  const hrwidth = {
    width: '650px',
    margin: '10px 0px 10px 0px',
    borderColor: '#fff'
  }
  
  
  
  
  
  
  let DATA = [
    {
      id: 1,
      author: 'Cookie',
      bio: 'Quam nunc et donec nec turpis a, semper.',
      photo: 'http://michaeldepippo.com/wp-content/uploads/2015/04/Monster_Bite_ChocolateChip_2.jpg',
      adpic: 'https://images-gmi-pmc.edge-generalmills.com/5504a4d4-ac62-4e63-b475-563ba492ccff.jpg'
    },
    {
      id: 2,
      author: 'Cakeee',
      bio: 'Lectus phasellus, mi ut nam velit per et dictum.',
      photo: 'http://img.taste.com.au/Dtv0xl-v/w643-h428-cfill-q90/taste/2016/11/black-forest-cake-92535-1.jpeg',
      adpic: 'http://assets.kraftfoods.com/recipe_images/opendeploy/%20138280-49fdab4f7bf207b3cc31f72186c86b0a642f0802_642x428.jpg'
    },
    {
      id: 3,
      author: 'Fruit',
      bio: 'Ipsum commodo, et placerat neque cursus.',
      photo: 'https://therawherbalist.com/wp-content/uploads/2017/12/04-ZS-Banned-Fruit-80-ab.jpg',
      adpic: 'https://spindriftfresh.com/wp-content/uploads/2017/12/fruit-header-1.jpg'
    },
    {
      id: 4,
      author: 'Chocolate',
      bio: 'Ipsum commodo, et placerat neque cursus.',
      photo: 'http://dubeat.com/wp-content/uploads/chocolates2.jpg',
      adpic: 'https://aadl.org/sites/default/files/inline-images/chocolate_0.jpeg'
    }
  ]
  
  class IconBox extends React.Component {
    render() {
      return <div style={iconbox}>
              {/*icon*/}
             <img style={icon} src='http://iconshow.me/media/images/ui/ios7-icons/png/512/chatbubble-outline.png' />
              <span style={iconword}>2</span>
  
             <img style={icon} src='https://png.icons8.com/material/1600/retweet.png' />
                <span style={iconword}>47</span>
  
             <img style={icon} src='https://cdn0.iconfinder.com/data/icons/small-n-flat/24/678087-heart-512.png' />
                <span style={{...iconword, ...red}}>190</span>
  
            <img style={icon} src='http://icons.iconarchive.com/icons/custom-icon-design/mono-general-2/512/mail-icon.png' />
            </div>
    }
  }
  
  const AdBox = (props) => (
    <div style={ADbox}>
      <div style={{...picbox,backgroundImage: `url(${props.adpic})`,}}></div>
      <div style={wordbox}>
        <span style={bold}>What a GOOD choice!</span>
        <p>Can't pry yourself away from the tutorials? The cure is to make tiny little experiment apps. </p>
        <p style={gray}>Cookie.com</p>
      </div>
    </div>
  )
  
  
  const Something = (props) => (
    <div>
      <p>{props.bio}</p>
      <p>author: <span style={blue}>@heeee</span></p>
    </div>
  )
  
  const Author = (props) => (
    <span style={bold}>{props.author}</span>
  )
  
  const FormCard = (props) => (
    <div>
      {
        DATA.map((props) => {
          return <div style={{...largebox, ...flex}} key={props.id}>
            <div style={{...Photo,backgroundImage: `url(${props.photo})`}}></div>
            <div>
              <Author author={props.author}/>
              <Something bio={props.bio}/>
              <AdBox adpic={props.adpic} />
              <IconBox />
            </div>
        </div>
        })
      }
    </div>
  )
  
  document.body.style.backgroundColor = "#c0deed";
  ReactDOM.render(<FormCard data={DATA} />, document.getElementById('app'))