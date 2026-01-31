import { Route, Switch } from "wouter";
import Index from "./pages/index";
import GraphPage from "./pages/graph";
import { Provider } from "./components/provider";

function App() {
        return (
                <Provider>
                        <Switch>
                                <Route path="/" component={Index} />
                                <Route path="/graph" component={GraphPage} />
                        </Switch>
                </Provider>
        );
}

export default App;
